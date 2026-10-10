# Phase Status

## PHASE: 0 — Architecture

STATUS: COMPLETE

WHAT WAS BUILT:

- Modular-monolith boundaries and monorepo layout.
- Vertical-driven configuration model with HVAC seed data only.
- PostgreSQL domain model, ERD, state machine, RBAC matrix, API guide, ADRs, security review, and roadmap.
- Explicit assumptions: CAD seed geography, human operations authority, local payment provider in development, and storage keys until production upload scanning is added.

KEY FILES:

- `docs/architecture.md`
- `docs/domain-model.md`
- `docs/service-request-workflow.md`
- `docs/permissions.md`
- `docs/adr/`

## PHASE: 1 — Foundation

STATUS: COMPLETE FOR MVP BASELINE

WHAT WAS BUILT:

- pnpm/Turbo monorepo with four Next.js apps and a Fastify API.
- PostgreSQL migrations and idempotent HVAC seed data.
- JWT authentication, role checks, resource checks, audit events, domain-event/outbox tables, notifications, and strict shared contracts.
- Shared responsive UI primitives used by all four applications.

## PHASE: 2–6 — MVP marketplace path

STATUS: COMPLETE FOR THE DOCUMENTED MVP PATH

WHAT WAS BUILT:

- Customer request and property flow, standard/emergency intake, operations qualification/dispatch, eligibility-aware matching, technician milestones, structured immutable quote versions, configurable payment milestones, completion, invoice, review, change orders, disputes/support, service history, relationship tracking, and rebooking.
- The lifecycle test exercises request → dispatch → quote → payment → work → completion → invoice → review against PostgreSQL.

## PHASE: 7 — Production hardening

STATUS: PARTIAL

REMAINING:

- Stripe Connect provider/webhook worker, Redis-backed rate limiting, S3 presigned uploads and malware scanning, MFA, refresh-token rotation, privacy workflows, observability exporters, and availability polygon/map integrations.

## Verification

```bash
DATABASE_URL=postgres://marketplace:marketplace@localhost:5433/marketplace \
JWT_SECRET=integration-test-secret-that-is-long-enough \
MARKETPLACE_INTEGRATION=1 pnpm test
```

Turbo explicitly passes these environment variables to the test task so the integration test cannot silently skip in CI.
