# Skilled Hire (skilledhire.ca)

**Skilled Hire** (`skilledhire.ca`) is a modular-monolith, multi-vertical trade & field-services marketplace engineered for licensed, verified contractor operations across Canada (including Ontario TSSA & Skilled Trades Ontario compliance, British Columbia Technical Safety, and cross-border standards). HVAC is seed data, not an application boundary: vertical-specific services, issues, credentials, emergency rules, payment rules, and warranty policies are entirely data-driven.

## MVP implemented

The API covers the first launch journey: authenticated customer request creation, operations qualification and dispatch, eligibility-aware ranking, technician job updates and itemized quotes, immutable quote acceptance, configurable payment milestones, sequential payments, completion, property service history, invoice creation, verified reviews, change orders, support/disputes, rebooking, and customer/contractor relationship tracking. The four apps include a responsive customer intake flow, contractor workboard, operations dispatch console, and admin policy/trust console.

## Quick start

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Apps: customer `:3000`, contractor `:3001`, operations `:3002`, admin `:3003`, API `:4000`.

See [architecture](docs/architecture.md), [local development](docs/local-development.md), and the OpenAPI-style route guide in [API documentation](docs/api.md).

For the full implementation status and honest production-hardening boundary, see [phase status](docs/phase-status.md) and [security review](docs/security-review.md).
