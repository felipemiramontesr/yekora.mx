# ADR 0011: Static SPA on Apache Hostinger and Headless Fastify API for Admin and Customer Account

- **Status:** Accepted (FC 027 · K-44)
- **Date:** 2026-11-01
- **Architectural Reference:** ADR 0011 (Platform Architecture / Admin & Account SPA)
- **Source:** Sovereign decisions of GrayMan (Ω) (chat, 2026-11-01; transmitted by Charlie in H 2026-11-01 17:10:14 / 17:37:43; formal analysis 240_AN, 241_AN, 242_AN, 245_AN).

## Context

Yēkora requires a unified authenticated customer area (`/cuenta`) and a backoffice administrative platform. The existing public storefront operates as a static export Next.js application (`output: 'export'`) deployed to Apache on Hostinger (`yekora.mx`, ADR 0001), while dynamic features and database transactions run via a headless Node.js/Fastify API on `apiv1.yekora.mx` (ADR 0006).

A monolithic Next.js deployment with Node.js SSR on the main domain was evaluated and rejected: Hostinger shared hosting performance is optimal under static file serving via Apache, and introducing server runtime on the main domain would break the high-performance CI pipeline (ADR 0001 / FC 026) and introduce operational coupling.

## Decision

1. **Static SPA Frontend Architecture (`output: 'export'`):**
   - The entire frontend codebase—including the public storefront, customer portal (`/cuenta`), and backoffice management views—is compiled as a 100% static export (`output: 'export'`).
   - The customer portal and administration routes are structured as an authenticated Single Page Application (SPA).
   - Apache on Hostinger (`public/.htaccess`) provides fallback routing: all requests under `/cuenta/*` and `/admin/*` that do not match a static physical asset rewrite internally to each area's own index (`/cuenta/index.html` and `/admin/index.html`), preventing unwanted fallbacks to the root homepage.

2. **Decoupled API Backend (`apiv1.yekora.mx`):**
   - The API remains completely decoupled in Fastify on `apiv1.yekora.mx`, serving data and handling mutations against MariaDB 11.8.9.
   - The client browser communicates directly with `https://apiv1.yekora.mx/v1/*` using native `fetch`.

3. **Session Authentication & Security:**
   - Authentication relies on cryptographic JSON Web Tokens / Bearer Tokens and secure session cookies.
   - All session cookies issued by the API strictly mandate the flags:
     - `HttpOnly` (inaccessible to JavaScript, mitigating OWASP A03 / XSS);
     - `Secure` (transmitted exclusively over TLS HTTPS);
     - `SameSite=Strict` (preventing Cross-Site Request Forgery / CSRF).
   - Administrative capabilities and role-based permissions are evaluated on the backend for every request.

## Consequences

- **Pros:** Preserves sub-200s static CI pipeline and zero-server attack surface on `yekora.mx`; zero operational overhead for SSR servers.
- **Cons:** Client-side rendering for `/cuenta` requires client state hydration and skeleton loading states; SEO is disabled for private account/admin routes (which is standard and desirable).
