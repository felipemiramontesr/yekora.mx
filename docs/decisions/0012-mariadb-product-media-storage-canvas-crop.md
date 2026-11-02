# ADR 0012: MariaDB Media Storage (MEDIUMBLOB), SHA-256 Deduplication, and In-Browser Canvas Cropping

- **Status:** Accepted (FC 027 · K-44)
- **Date:** 2026-11-01
- **Architectural Reference:** ADR 0012 (Platform Architecture / MariaDB Media Storage)
- **Source:** Sovereign decisions of GrayMan (Ω) (chat, 2026-11-01; transmitted by Charlie in H 2026-11-01 17:10:14 / 17:37:43; formal analysis 240_AN, 241_AN, 242_AN, 245_AN).

## Context

Yēkora requires product images and media management for the backoffice catalog. Storing images in external cloud object storage (AWS S3, Cloudflare R2) was rejected by sovereign decree of GrayMan (Ω) to eliminate monthly recurring SaaS bills. Storing images directly on Hostinger's web server disk (`public_html/images/`) was rejected because the CI deployment workflow executes `rsync -avz --delete` (`.github/workflows/deploy.yml`), which would wipe out runtime user-uploaded images on every production deployment.

Inspiration is drawn from the Archon ERP architecture, modernized and hardened to avoid Base64 string encoding bugs and data truncation.

## Decision

1. **Direct Binary Storage in MariaDB (`MEDIUMBLOB`):**
   - Media files are stored directly in MariaDB 11.8.9 in the dedicated table `product_media`.
   - The binary payload is stored in a `MEDIUMBLOB` column (capacity up to 16,777,215 bytes / 16 MB).
   - Storing raw binary eliminates the 33% size expansion overhead and truncation risks inherent in Base64 `LONGTEXT` storage.

2. **Deduplication by SHA-256 Hash:**
   - Every media item is indexed and identified by the cryptographic `sha256` hash (64 hex characters) of its binary payload.
   - Duplicate image uploads are automatically deduplicated at the storage layer.

3. **In-Browser Canvas Cropping & Derivations:**
   - The admin backoffice UI provides an interactive HTML5 canvas cropping tool (pan, zoom, crop).
   - The browser generates 3 standardized derivatives before upload:
     - `1200 px` (catalog detail / hero);
     - `600 px` (product card / grid);
     - `300 px` (cart thumbnail / mini-cart).
   - Derivatives are produced in WebP with optimized compression, with JPEG as fallback.

4. **Security & Format Restrictions:**
   - Magic bytes verification is enforced on Fastify before accepting any binary payload.
   - Allowed MIME types: strictly `image/webp` and `image/jpeg`.
   - **SVG is strictly forbidden** (`image/svg+xml`) to prevent Cross-Site Scripting (XSS / OWASP A03).

5. **High-Performance Public Delivery & Cache:**
   - The API serves media via `GET /v1/media/:sha256`.
   - Responses include immutable HTTP headers:
     `Cache-Control: public, max-age=31536000, immutable`
     `ETag: "<sha256>"`
   - Browsers and CDNs cache each image permanently; API bandwidth is consumed exactly once per client/image.

6. **Migration & Deprecation of `product_images`:**
   - The existing `product_images` table (from migration 001, which stored filesystem paths under `/images/products/%`) will be ingested into `product_media` in FC 029 (K-46), followed by the retirement of the physical image assets from the git repository.

7. **Business Continuity (ISO/IEC 25010 S06):**
   - Media is automatically included in database backups (`mysqldump`) and disaster recovery drills without external storage synchronization dependencies.

## Consequences

- **Pros:** Zero cloud storage bills; zero risk of file destruction by `rsync --delete`; complete backup and restore consistency in MariaDB.
- **Cons:** Database dump sizes grow with catalog volume; mitigated by 16 MB limits, WebP compression, and deduplication.
