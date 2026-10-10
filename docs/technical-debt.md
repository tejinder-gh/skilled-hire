# Technical Debt Register

| Item | Risk | Planned phase |
| --- | --- | --- |
| Production Stripe Connect adapter and webhook worker | Financial operations currently use deterministic local provider | Phase 4 hardening |
| Durable outbox/BullMQ notifications | Lifecycle events are audited but not queued | Phase 5 |
| S3 upload/scanning adapter | Upload keys are modeled only | Phase 1 hardening |
| Production provider adapters, payout release worker, and evidence-backed milestone automation | MVP records local payment transactions and holds payouts; release and webhook workers remain to be connected | Phase 4 hardening |
| Full admin CRUD and analytics dashboards | Current admin surface is a policy/trust console; CRUD and event analytics need durable screens | Phase 5 |
| Geographic polygon service areas and availability blocks in matcher | Candidate ranking currently uses configured vertical/credential/location data | Phase 2 hardening |
