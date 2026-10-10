# Domain Model and ERD

```mermaid
erDiagram
  USER ||--o{ USER_ROLE : has
  USER ||--o{ PROPERTY : owns
  VERTICAL ||--o{ SERVICE_CATEGORY : configures
  SERVICE_CATEGORY ||--o{ ISSUE_TYPE : contains
  PROPERTY ||--o{ SERVICE_REQUEST : receives
  VERTICAL ||--o{ SERVICE_REQUEST : scopes
  SERVICE_REQUEST ||--o| JOB : becomes
  CONTRACTOR ||--o{ TECHNICIAN : employs
  CONTRACTOR ||--o{ CREDENTIAL : holds
  TECHNICIAN ||--o{ CREDENTIAL : holds
  JOB }o--|| TECHNICIAN : assigned_to
  JOB ||--o{ QUOTE : has
  QUOTE ||--o{ QUOTE_ITEM : contains
  QUOTE ||--o{ PAYMENT_SCHEDULE : produces
  PAYMENT_SCHEDULE ||--o{ PAYMENT_MILESTONE : has
  JOB ||--o{ SERVICE_RECORD : records
  SERVICE_RECORD ||--o{ WARRANTY : may_create
  JOB ||--o| REVIEW : verifies
  USER ||--o{ AUDIT_EVENT : acts
```

All money is stored as integer minor units with ISO currency. Financial and audit records are immutable/append-only. User-facing records use soft deletion where permitted; retained financial/audit data can be anonymized rather than erased.
