# ADR 0008: Guest Shopping Cart with Local Persistence, Server Quotation, and 16% VAT Breakdown

- **Status:** Proposed (prepared for FC 009)
- **Date:** 2026-10-19
- **Source:** Decisions of GrayMan (Ω) (chat, 2026-10-19): «Base prices captured without VAT; system calculates 16% VAT and displays final price to consumer; top-tier ecommerce guest cart experience; incorporate maintenance items K-12 and K-13». Complementing ADR 0001, ADR 0003, ADR 0006, and ADR 0007.

## Context

Following the successful deployment of the product catalog (FC 008, V.0.4.4), YÉKORA requires shopping cart functionality (K-04) to enable customers to select items, adjust quantities, verify stock, and review price totals before entering checkout (K-05).

Because the frontend is a static Next.js export served by Apache (ADR 0001), state persistence and computation must be structured cleanly between client and server without exposing security vulnerabilities, violating consumer protection laws (LFPC / PROFECO), or compromising data integrity.

## Decision

1. **Client-Side Guest Cart Persistence (No PII):**
   - The shopping cart operates entirely for guest visitors without requiring account registration or login.
   - Persisted in client `localStorage` under the technical key `yekora_cart_v1`.
   - The stored state contains **only** technical product references: `[{ sku: string, quantity: number }]`.
   - **Zero Personal Data:** No names, emails, addresses, or payment tokens are stored in the cart, preserving compliance with Mexican privacy laws (LFPDPPP) and eliminating personal data exposure risk.

2. **Server-Side Pricing and Stock Authority:**
   - The client is **never** the source of truth for pricing, discounts, tax rates, or stock availability.
   - The API (`apiv1.yekora.mx`) exposes `POST /v1/cart/quote` accepting the array of items and returning an authoritative quotation calculated with bound SQL queries against MariaDB.
   - Fastify CORS allowlist is updated to permit `POST` strictly for `/v1/cart/quote` from `https://yekora.mx`, `http://localhost:3000`, and `http://localhost:3100`.
   - Service Worker (`public/sw.js`) explicitly bypasses any caching for `/v1/cart/quote`.

3. **Tax Model and Calculation (Net Prices with 16% VAT / LFPC Compliance):**
   - Per Ω's authoritative decision (073_AN, chat 2026-10-19): `products.price_mxn_cents` stores the **net price** (including 16% VAT) in integer cents. The optional gross-to-net calculator is an administrative helper assigned to K-07 (Backoffice).
   - In accordance with Article 7 Bis of the Mexican Federal Consumer Protection Law (LFPC), the catalog and product detail pages display the net price with the mandatory «IVA incluido» notice directly as delivered by `/v1/catalog`.
   - In the cart, calculations are exact and avoid unit vs line rounding discrepancies:
     - `lineTotalMxnCents = unitPriceMxnCents * quantity`
     - `lineBaseMxnCents = Math.round(lineTotalMxnCents * 100 / 116)`
     - `lineTaxMxnCents = lineTotalMxnCents - lineBaseMxnCents`
   - In the cart summary:
     - **Subtotal:** Sum of line base amounts (`subtotalMxnCents = sum(lineBaseMxnCents)`).
     - **IVA (16%):** Sum of line VAT amounts (`taxMxnCents = sum(lineTaxMxnCents)`).
     - **Total:** Final payable amount (`totalMxnCents = sum(lineTotalMxnCents)`).
     - By definition, `subtotalMxnCents + taxMxnCents === totalMxnCents` with exact integer consistency.
   - The English USD reference is calculated against the net total using Banxico FIX: `Math.round(totalMxnCents / fixRate)`.

4. **Stock Validation and Resiliency:**
   - The quote response verifies requested quantity against `products.stock_quantity`.
   - Returns stock status per line item (`available`, `low_stock`, `out_of_stock`) and warning messages if quantity was adjusted to available inventory.
   - Stock is not reserved at the cart stage; reservation occurs exclusively during checkout payment authorization (K-05).
   - If the production database has zero products (pre-K-07), the cart displays a functional empty state («Tu mochila está vacía») without exposing broken UI or pending stubs.

5. **Top-Tier UI/UX:**
   - Persistent mini-cart icon in header with accessible live counter `<output aria-live="polite">` (complying with Sonar S6819).
   - Dedicated cart view at `/carrito/` (ES) and `/en/cart/` (EN), plus slide-over cart drawer for seamless inline shopping.
   - Tactile touch targets $\ge 44 \times 44\text{ px}$ across all 6 viewports.

6. **Maintenance Scope (K-12 & K-13):**
   - Resolves forensic backlog items K-12 (timed production backup restoration trial and external fork PR review verification) and K-13 (`API_LIVE` variable CI validation) in Phase 0.

## Consequences

- Completely stateless API architecture: the server does not maintain abandoned cart sessions in the database, avoiding database bloat.
- Zero PII collected or stored, allowing cart functionality to ship prior to customer account infrastructure (K-07).
- Full legal compliance with Mexican commercial standards (PROFECO) and robust tax traceability preparing for future CFDI 4.0 invoicing (K-06).
- RWD testing expanded from 102 to 114 cells (19 routes $\times$ 6 viewports).
