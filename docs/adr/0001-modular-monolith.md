# ADR 0001: Modular monolith

**Status:** Accepted

Use one deployable API with bounded modules and an internal event outbox. Marketplace workflows need transactions and human operations during launch. Extract services only when independent scaling or failure isolation is demonstrated.
