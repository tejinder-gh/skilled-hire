# Local Development

Run the commands from the root README. PostgreSQL is the source of truth; Redis and MinIO model production supporting services. To avoid commonly occupied local ports, Compose publishes PostgreSQL on `5433`, Redis on `6380`, and MinIO on `9002` (override with the documented `*_PORT` variables). `pnpm db:migrate` applies ordered SQL migrations and `pnpm db:seed` inserts idempotent HVAC fixtures. The local payment provider is deterministic; set Stripe keys only when testing Stripe webhooks.
