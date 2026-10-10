# Authorization Model

Authorization is enforced in the API. The web applications do not decide whether an action is permitted.

| Capability | Customer | Technician | Operations / Dispatch | Support | Admin |
| --- | --- | --- | --- | --- | --- |
| Create and view own properties | own | — | support view | support view | all |
| Create and cancel own requests | own | — | all | support view | all |
| View assigned job | own customer jobs | assigned jobs only | all | linked jobs | all |
| Rank and assign technicians | — | — | yes | — | yes |
| Submit itemized quote | — | assigned jobs only | quote review | — | override/review |
| Accept quote / pay | own customer jobs | — | payment visibility | refund workflow | refund / override |
| Complete job | — | assigned jobs | operational override | — | override |
| Open support ticket / dispute | own jobs | support request | all | all | all |
| Verify credentials / suspend provider | — | — | — | — | admin only |

Resource checks are repeated on sensitive endpoints. In particular, dispatch assignment re-evaluates vertical support, provider status, emergency capability, and required non-expired credentials inside the assignment transaction; it does not trust a candidate ID supplied by a client.
