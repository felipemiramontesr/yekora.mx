# ADR 0009: Dual Payment Gateway Architecture (Stripe + Mercado Pago), Hosted Checkout, and PII Protection

- **Status:** Proposed (prepared for FC 012)
- **Date:** 2026-10-20
- **Source:** Sovereign decisions of GrayMan (Ω) (K-21, chat 2026-10-19/20, 087_AN): «Stripe (1st) and Mercado Pago (2nd) from inception; checkout opens to the public with both methods together; client business accounts pending (K-26); test mode during development; production release blocked by K-26 and K-20». Complements ADR 0001, ADR 0003, ADR 0006, ADR 0007, and ADR 0008.

## Context

Following the implementation of the canonical shopping cart (FC 009, V.0.5.2) and configurable shipping engine (FC 011, V.0.7.0), YÉKORA requires a complete, secure checkout and payment solution (K-05 / FC 012) to convert customer carts into finalized, paid orders.

In the Mexican e-commerce market, consumer payment preferences are divided: many tech-forward users prefer international credit/debit card processing (Stripe), while a substantial volume of Mexican retail buyers rely on Mercado Libre ecosystem balances, local debit cards, bank transfers (SPEI), and cash payment vouchers at convenience stores like OXXO (Mercado Pago). To maximize conversion without fragmenting the customer journey, Ω decreed that **both Stripe and Mercado Pago must be available together from the public launch**.

Furthermore, the business client has not yet finalized corporate business entity verification on Stripe and Mercado Pago (K-26) and tax credentials (RFC/tax regime in K-20). The software architecture must support complete test-driven development, continuous integration, and sandbox testing without live business credentials, while guaranteeing a strict **fail-closed** posture in production until verified live secrets are provisioned.

## Decision

1. **Decoupled Port & Adapter Pattern (`PaymentProcessorPort`):**
   - Core order management, financial calculations (net amount + 16% VAT per ADR 0008), inventory reservations, and state machine transitions reside strictly within YÉKORA's backend domain (`apps/api`).
   - Payment operations are abstracted through a unified interface:
     - `createPaymentSession(order: Order, options: SessionOptions): Promise<PaymentSession>`
     - `verifyWebhookSignature(headers: Record<string, string>, rawBody: Buffer): boolean`
     - `parseWebhookEvent(headers: Record<string, string>, rawBody: Buffer): WebhookEvent`
     - `reconcilePaymentStatus(processorPaymentId: string): Promise<PaymentReconciliation>`
   - Two concrete adapters implement this port: `StripeAdapter` and `MercadoPagoAdapter`. The checkout domain interacts exclusively through the port.

2. **Hosted Checkout & Tokenization (PCI-DSS SAQ A / Zero Card Data):**
   - YÉKORA never collects, transmits, processes, or stores raw Primary Account Numbers (PAN), CVVs, or card expiration dates on its servers or browser DOM.
   - Both integrations utilize hosted redirection or hosted field elements:
     - **Stripe:** Stripe Checkout hosted session or Stripe Elements.
     - **Mercado Pago:** Mercado Pago Checkout Pro hosted preference.
   - This architecture qualifies YÉKORA for the minimal PCI-DSS compliance scope: **SAQ A**.

3. **Authoritative Server Pricing and Canonical Order Creation:**
   - The browser never submits prices, tax calculations, or line totals.
   - Checkout begins with `POST /v1/checkout/session`, which takes the items array and validates it against the authoritative MariaDB catalog and stock using the exact logic of `POST /v1/cart/quote`.
   - Prices are passed to the payment processor as line items generated on the server on the fly; no static products or prices are registered in the processor dashboards, preventing sync drift.

4. **Webhook Security, Idempotency, and Active Reconciliation:**
   - Both webhook endpoints (`/v1/webhooks/stripe` and `/v1/webhooks/mercadopago`) require mandatory cryptographic signature verification:
     - Stripe: `Stripe-Signature` validation using the webhook signing secret.
     - Mercado Pago: `x-signature` HMAC-SHA256 validation.
   - **Idempotency Guarantee:** Incoming webhook event identifiers are recorded in an audit table `payment_events`. If an event ID has already been recorded and processed, the endpoint acknowledges with HTTP 200 immediately without re-triggering fulfillment or state changes.
   - **Active Reconciliation:** Upon receiving a payment confirmation webhook, the server does not rely solely on the webhook payload; it actively queries the payment processor's API to verify the definitive status of the transaction.

5. **Asynchronous Payments (OXXO / SPEI) & Inventory Reservation:**
   - Cash vouchers (OXXO) and SPEI transfers take hours or days to complete.
   - When an asynchronous session is initiated, the order is placed in `PENDING_PAYMENT`, and requested product quantities are marked as `reserved_stock` in MariaDB with a strict Time-To-Live (TTL, e.g., 48 hours for OXXO).
   - If payment is confirmed before expiration, reserved stock is converted to committed sale. If TTL expires without payment confirmation, reserved stock is automatically returned to available inventory and the order transitions to `EXPIRED`.

6. **Customer Personal Data (PII) Protection & Application-Level Encryption (YekoraALE):**
   - Guest checkout collects customer contact and delivery information in Mexico: full name, email, phone (10 digits), and physical shipping address (street, exterior/interior number, colonia, municipality, state, 5-digit Mexican postal code).
   - Under the Mexican Federal Law on Protection of Personal Data Held by Private Parties (LFPDPPP), these data fields constitute sensitive PII.
   - In accordance with our security architecture (FC 010 / YekoraALE), PII columns in MariaDB (`customer_name_enc`, `customer_email_enc`, `customer_phone_enc`, `shipping_address_enc`) are stored encrypted at rest using AES-256-GCM with keys managed in secure environment variables.
   - OWASP A07 remains classified as **RESERVED SLOT** because checkout operates for guest shoppers without user authentication or password sessions.

7. **Database Schema Integrity (Zero ENUM / Zero ORM):**
   - In strict compliance with ADR 0003 (raw SQL, zero ORM) and ADR 0007 (zero ENUM/SET), all state and processor codes use relational lookup tables:
     - `order_statuses`: Lookup table (`PENDING_PAYMENT`, `PAID`, `EXPIRED`, `CANCELLED`, `REFUNDED`).
     - `payment_processors`: Lookup table (`stripe`, `mercadopago`).
     - `orders`, `order_items`, `payment_events`: Relational tables with foreign key constraints and integer monetary amounts in Mexican centavos (`_mxn_cents`).

8. **Test Mode Isolation and Fail-Closed Production Stance:**
   - Development and CI run strictly using test credentials (`sk_test_` for Stripe, `TEST-` for Mercado Pago) with mocked network calls in automated tests (zero live network in CI).
   - A CI AST/environment guard ensures test keys are never deployed to production environments and live keys are never used in test suites.
   - If production runs without valid live secrets (prior to resolution of K-26 and K-20), the payment initiation API fails closed with **HTTP 503 Problem Details (RFC 7807)**, and the frontend checkout interface clearly states that online payments are being activated, disabling checkout submission while keeping cart and catalog functional.

## Consequences

- Full coverage of Mexican consumer payment modalities (cards + cash vouchers + digital wallets) from day one.
- Minimal compliance overhead: Zero cardholder data touchpoints ensures PCI-DSS SAQ A compliance.
- Transparent, audit-proof financial records: Canonical line items, exact VAT 16% breakdown, and audit log of every webhook event prevent double-charging or phantom fulfillment.
- Strict isolation of business credentials: The system is ready to operate in production immediately upon provision of live API keys by the business client without modifying codebase logic.
