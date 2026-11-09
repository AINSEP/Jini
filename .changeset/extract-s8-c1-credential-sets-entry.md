---
"@jini-ai/integrations": minor
---

Add the `@jini-ai/integrations/credentialed-http/sets` entry: credential-set validation and CRUD
over a host-supplied vault (`CredentialSetVaultRepo`, create/update/delete/list/describe/resolve
operations, canonical credential-set error classes) and its host-input contracts. Every owner,
metadata, category, scope, error and wording value is a required host input. The existing
`./credentialed-http` entry is unchanged.
