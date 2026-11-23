---
"@jini-ai/integrations": patch
---

Move host-neutral vendor-credentials code from the host. `./vendor-credentials/abort-guarded-repo` (`abortGuardedCredentialRepo`) refuses persistence writes after an abort. A new characterization test covers it.
