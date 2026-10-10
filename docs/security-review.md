# MVP Security Review

## Implemented controls

- JWT authentication with short-lived tokens and server-side session-version invalidation.
- Role and resource-level checks on customer, technician, dispatch, quote, payment, completion and review paths.
- Zod validation at API boundaries; parameterized PostgreSQL queries; strict TypeScript.
- Integer minor-unit financial arithmetic, frozen accepted quotes, idempotency keys on payment and quote acceptance, and append-only audit events.
- Helmet, allowlisted CORS, no card storage, and secret values supplied only by environment variables.
- Credential eligibility filters reject non-verified and expired credentials during ranking.
- Dispatch assignment re-checks the selected technician against the request vertical, emergency capability, contractor verification, and required geography-aware credentials inside a transaction.
- Payment idempotency keys are bound to actor and operation/resource, and milestone payment enforces sequential completion. Refunds cannot exceed the original transaction cumulatively.

## Must complete before production

- Register a distributed rate-limit plugin backed by Redis, add refresh-token rotation/CSRF protection for cookie sessions, and enforce staff MFA at login.
- Implement S3 pre-signed upload policy, magic-byte validation, malware scanning, retention/anonymization workflows, and signed download authorization.
- Add Stripe webhook signature validation and persist/replay-guard actual provider events.
- Pen-test resource-authorization paths and enable OpenTelemetry/Sentry alerting, database encryption/backups and secret-manager deployment.
