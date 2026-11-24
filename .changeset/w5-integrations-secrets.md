---
"@jini-ai/integrations": major
---

`RootKeyHandle`, `KeyringPort`, `SecretSealerPort` and `SealedSecret` are no longer exported from `@jini-ai/integrations/webhooks`; import them from the new `@jini-ai/integrations/secrets` subpath. Adds `@jini-ai/integrations/vendor-credentials/project-scope` (`credentialScopes`, `credentialCreateTarget` and the `CredentialScope`, `CredentialProjectHalf`, `ScopedCredentialDeps` types), moved from a host app.
