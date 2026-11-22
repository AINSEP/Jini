---
"@jini-ai/integrations": patch
---

Move host-neutral vendor-credentials code from the host. `./vendor-credentials/abort-guarded-repo` (`abortGuardedCredentialRepo`) refuses persistence writes after an abort, and `./vendor-credentials/project-scope` (`credentialScopes`, `credentialCreateTarget`, `CredentialScope`, `CredentialProjectHalf`, `ScopedCredentialDeps`) holds the shared site/owner-store scope policy for credential stores. New characterization tests cover both.
