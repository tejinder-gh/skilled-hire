# Payments

`PaymentProvider` isolates Stripe Connect. Domain code creates payment intents, transactions, schedules, milestones, refunds and payouts without importing Stripe. Webhooks require a verified provider signature, provider event ID uniqueness, and an idempotency key. Amounts are integer cents and quote totals are recalculated server-side.

The launch engine derives schedules from configured rules. The seeded HVAC repair rule creates a 20% quote-approval deposit and an 80% completion payment. This is seed configuration, not a global business rule.
