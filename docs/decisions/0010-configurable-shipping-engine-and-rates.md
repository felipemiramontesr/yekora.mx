# ADR 0010: Configurable Shipping Engine, Multi-Strategy Determination, and Package Dimensioning

- **Status:** Accepted — implemented in FC 011 (V.0.7.0); see «Implementation notes» for where the build refined this text.
- **Date:** 2026-10-20
- **Source:** Sovereign decisions of GrayMan (Ω) (092_AN §1, chat 2026-10-20): «Configurable shipping engine replaces per-product shipping capture; top-tier ecommerce logic; separate FC before checkout (K-27); Admin chooses and combines strategies; provider port with CI mock; real carrier account blocked by K-28». Complements ADR 0001, ADR 0003, ADR 0007, ADR 0008, and ADR 0009.

## Context

In e-commerce, capturing shipping costs as a static attribute per product does not scale: customer orders contain multiple items, varying physical dimensions, distinct shipping classes (standard vs. bulky), and regional delivery destinations. In Mexico, commercial logistics carriers charge according to **chargeable weight** (the greater of actual physical weight and volumetric dimensional weight: $L \times W \times H / 5000$).

Ω decreed that YÉKORA must adopt a **configurable shipping engine** that models top-tier commercial practices, executes deterministically on the server, calculates shipping **once per order** (not per product), supports multiple administrative strategies (flat rate, regional zone, zone $\times$ class, weight brackets, order total tiers, and free shipping thresholds), and prepares for live carrier aggregators via an abstract port, prior to the checkout phase (K-05).

## Decision

1. **Product Physical Attributes and Zero Shipping Cost in Catalog:**
   - Products do not store any shipping cost or price. `products.shipping_mxn_cents` is abolished.
   - Instead, physical properties are modeled in `products`:
     - `weight_grams` (integer $\ge 0$): physical weight in grams.
     - `length_mm`, `width_mm`, `height_mm` (integers $\ge 0$): physical dimensions in millimeters.
     - `shipping_class_id` (foreign key to `shipping_classes`): logistics class (e.g., standard, fragile, bulky/heavy).

2. **Relational Schema without ENUM/SET (ADR 0003 & ADR 0007):**
   - Logistics parameters are stored in normalized MariaDB tables:
     - `shipping_zones`: Geographic destinations (32 Mexican states, extensible to 5-digit postal code ranges).
     - `shipping_classes`: Classification of items based on handling requirements (`standard`, `bulky`).
     - `shipping_strategies`: Administrative evaluation strategies (`FLAT_RATE`, `ZONE_RATE`, `ZONE_CLASS_RATE`, `CHARGEABLE_WEIGHT`, `ORDER_TOTAL`).
     - `shipping_rules`: Configurable rates, weight limits, postal code mappings, and thresholds.
     - `shipping_configs`: Active configuration selected by the Admin, including free shipping modifier threshold.

3. **Chargeable Weight Computation:**
   - For any cart with $M$ items, total package weight is computed as:
     - Actual physical weight: $W_{\text{actual}} = \sum (\text{item.weight\_grams} \times \text{item.quantity})$.
     - Volumetric weight: computed using standard Mexican logistics formula ($L \times W \times H \text{ in cm} / 5000$ converted to grams).
     - Chargeable weight: $W_{\text{chargeable}} = \max(W_{\text{actual}}, W_{\text{volumetric}})$.

4. **Deterministic Precedence and Server-Side Computation:**
   - Shipping is calculated strictly on the server; the client never determines or alters rates.
   - **Precedence Hierarchy:**
     1. **Free Shipping Qualifier:** If `subtotal_net_mxn_cents >= free_shipping_threshold_mxn_cents`, the shipping fee is exactly $0 MXN.
     2. **Active Strategy Evaluation:** Evaluates the active administrative strategy against the delivery destination and order payload.
     3. **Unserviceable Destination (No Invention):** If no configured rule applies to the destination zone, the shipping engine returns an unserviceable notice (`serviceable: false`) with a polite explanation; shipping cost is never fabricated or defaulted to arbitrary figures.

5. **16% VAT Breakdown on Shipping:**
   - In accordance with Mexican tax law and ADR 0008, commercial shipping charges are subject to 16% VAT.
   - The shipping quote provides explicit tax breakdown:
     - `shippingBaseMxnCents = Math.round(shippingTotalMxnCents * 100 / 116)`
     - `shippingTaxMxnCents = shippingTotalMxnCents - shippingBaseMxnCents`
     - Matches the canonical breakdown of the shopping cart and checkout.

6. **Decoupled Carrier Port (`ShippingRateProvider`):**
   - Defined as an abstract port with concrete adapters:
     - `InternalTableRateAdapter`: Computes rates from MariaDB rules (v1 default).
     - `MockShippingProvider`: Deterministic responses for automated unit and CI tests.
     - `CarrierAggregatorAdapter`: Reserved for live carrier rate queries (Envia.com, Skydropx); activation blocked by **K-28** (client commercial shipping account).

7. **Cart and Checkout Timing:**
   - In the cart (`/carrito/`), before a delivery destination is specified, the UI displays the standard top-tier notice: «El costo de envío se calcula al ingresar tu dirección».
   - If the customer enters their state or postal code, the cart requests `POST /v1/shipping/quote` to display the exact shipping amount.
   - Checkout uses the destination address to bind the authoritative shipping charge into the order record.

## Consequences

- Completely eliminates arbitrary or hardcoded shipping fees per product.
- Provides business agility: Store administrators can adjust shipping fees, offer temporary promotions (e.g., free shipping over $999 MXN), or charge accurate regional rates without code changes.
- Prepares YÉKORA for seamless integration with real Mexican logistics carriers once K-28 is resolved by the business client.
- Decouples checkout implementation: Checkout (FC 012 / K-05) simply consumes the shipping engine contract without embedding logistics pricing logic.

## Implementation notes (FC 011, V.0.7.0)

The decision stands; the build refined these points (each declared in FC 011 and audited in F6):

- **Physical data is mandatory and positive**, not `≥ 0`: `NOT NULL`, `CHECK (> 0)` and a foreign key to `shipping_classes`, added by one atomic `ALTER` in migration 002. A product without it cannot exist, so it can never ship for free by accident.
- **Free shipping needs a covering rule.** Precedence is: the destination must be a known zone, then a rule of the active strategy must cover the purchase, and only then the free-shipping modifier may zero it (`itemsTotal` with VAT ≥ threshold). No configuration or no rule means `UNSERVICEABLE_DESTINATION`; no tariff is ever invented.
- **No parallel endpoint.** Shipping is priced inside the canonical `POST /v1/cart/quote` with an optional `destination` (truth table T1.1: 400 `EMPTY_OR_UNAVAILABLE_CART`, 400 `INVALID_DESTINATION`, 200 not serviceable). `/v1/shipping/quote` does not exist.
- **The charge is one more line of the quote**, split with the same VAT rule as products (`splitVat` in `apps/api/src/lib/money.ts`); the grand totals add it.
- **Nothing is seeded but the catalogs** (32 states, 2 classes, 5 strategies): no configuration and no rates, by Ω's decision, until real rates are loaded.
- **The browser remembers only the state code**, in its own key `yekora_shipping_state_v1`; never a postal code or an address.
