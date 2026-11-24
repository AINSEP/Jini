# `vendor-credentials`

Host-neutral helpers around a site's credential repositories.

- `./vendor-credentials/abort-guarded-repo` — wraps a credential repo so writes refuse an aborted signal.
- `./vendor-credentials/project-scope` — the site-first / owner-store-fallback scope policy
  (`credentialScopes`, `credentialCreateTarget`) and its `CredentialProjectHalf` shape.

## Wiring

The host's composition root attaches the owner store's half as `deps.repo.project`
(`CredentialProjectHalf`: workspace id, repo, sealer, keyring, and optional `createRepo` /
`replaceRepo`); omit it on hosts without an owner store and only the site scope is returned.
`credentialCreateTarget` takes the host's own validation-error factory (`invalid`) so a bad
`scope` surfaces as the host store's error type.
