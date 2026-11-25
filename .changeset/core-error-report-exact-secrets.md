---
"@jini-ai/core": minor
---

The error reporter now forwards every exact secret it knows for an incident (the host's standing ones and the call's own `exactSecrets`) to the tracker adapter on `ErrorReport.context.exactSecrets`. The adapter receives the original error, so without these values a token the request carried could leave the process verbatim. `exactSecrets` is private, in-process redaction input: an adapter blanks those values from the error and never serializes, logs or forwards the array. The field is absent when no exact secret is known.
