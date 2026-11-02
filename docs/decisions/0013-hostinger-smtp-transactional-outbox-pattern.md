# ADR 0013: Hostinger Corporate SMTP and Transactional Outbox Pattern

- **Status:** Accepted (FC 027 · K-44)
- **Date:** 2026-11-01
- **Architectural Reference:** ADR 0013 (Platform Architecture / Transactional Outbox)
- **Source:** Sovereign decisions of GrayMan (Ω) (chat, 2026-11-01; transmitted by Charlie in H 2026-11-01 17:10:14 / 17:37:43; formal analysis 240_AN, 241_AN, 242_AN, 245_AN).

## Context

Transactional emails (account verification, 2FA codes, security notices, order confirmations) and CRM marketing campaigns require a reliable, deliverable dispatch mechanism without third-party email API fees (SendGrid, Postmark, Resend). GrayMan (Ω) decided to utilize the corporate email service bundled with Hostinger under the domain `yekora.mx`.

Performing synchronous SMTP network calls inside Fastify HTTP request handlers introduces major operational risks: latency spikes (3-10s per request), thread blocking, vulnerability to transient SMTP timeouts, and lack of atomic guarantee between database mutations and email dispatch.

## Decision

1. **Transactional Outbox Table (`outbox_events`):**
   - The table `outbox_events` is introduced in `028_FC` (K-45) to handle 2FA codes and auth alerts, and reused by `031_FC` (orders) and `032_FC` (CRM campaigns).
   - Any business operation that requires an email persists the event row within the **same ACID database transaction** as the business mutation.
   - **Zero Synchronous SMTP in HTTP Handlers:** Handlers never open SMTP sockets during request execution.

2. **Asynchronous Outbox Dispatch Worker:**
   - A background queue runner periodically reads pending records (`status = 'PENDING'`) using optimistic locking (`SELECT ... FOR UPDATE` or atomic status update).
   - Dispatches via SMTP using Node.js `nodemailer` connected to Hostinger's secure mail server (`smtp.hostinger.com`, TLS port 465).
   - Enforces rate limiting (maximum emails per minute) to comply with Hostinger's hosting plan limits.
   - Implements exponential backoff retries (`retry_count`, `next_retry_at`) and marks final status (`SENT`, `FAILED`).

3. **DNS & Deliverability Alignment:**
   - The `yekora.mx` DNS zone is configured with valid SPF, DKIM, and DMARC records to prevent spoofing and ensure high inbox delivery rates.

## Consequences

- **Pros:** 100% atomic email dispatch; zero request latency overhead; zero external SaaS costs; automatic retries and full audit trail of sent messages.
- **Cons:** Near-instant email delivery has a sub-second queue latency (1-3s polling interval).
