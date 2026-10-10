# ADR 0003: Multi-vertical configuration

**Status:** Accepted

Vertical services, issue types, requirements, SLA, fees and policies live in configuration tables. Core request, quote, payment, compliance and property-history modules reference `verticalId` and do not import vertical-specific code.
