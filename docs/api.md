# API Guide

Authenticated routes use `Authorization: Bearer <token>` and accept `Idempotency-Key` on mutation endpoints.

| Route | Purpose |
| --- | --- |
| `POST /v1/auth/login` | login with email/password |
| `POST /v1/service-requests` | customer creates request |
| `POST /v1/service-requests/:id/transition` | authorized state transition |
| `GET /v1/dispatch/:requestId/candidates` | ranked eligible technicians |
| `POST /v1/dispatch/:requestId/assign` | operations assigns technician |
| `POST /v1/jobs/:id/quotes` | technician submits structured quote |
| `POST /v1/quotes/:id/accept` | customer accepts frozen quote and creates schedule |
| `POST /v1/payment-milestones/:id/pay` | create/confirm payment via provider |
| `POST /v1/jobs/:id/complete` | complete job and service record |
| `POST /v1/jobs/:id/reviews` | verified customer review |
| `POST /v1/jobs/:id/change-orders` | technician submits additional work for approval |
| `POST /v1/change-orders/:id/accept` | customer accepts a change order and adds a payment milestone |
| `POST /v1/change-orders/:id/decline` | customer declines a change order |
| `POST /v1/jobs/:id/invoice` | issue an immutable invoice after completion and full payment |
| `GET /v1/properties/:id/history` | property-centric service history |
| `POST /v1/service-records/:id/rebook` | recreate a request from a completed service record |
| `POST /v1/support-tickets` | support request or dispute with evidence |
| `POST /v1/refunds` | authorized partial or full refund record |

Errors conform to `{ code, message, requestId }`; no internal stack traces are returned.
