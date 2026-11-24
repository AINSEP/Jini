---
"@jini-ai/cms": patch
---

The credential route specs ship only the verbs a host mounts. `@jini-ai/cms/admin-http/routes/system/publish-credentials/list` is gone, and `@jini-ai/cms/admin-http/routes/system/custom-credentials` no longer exports `customCredentialListRoute`, `customCredentialUpdateRoute`, their deps types or `CustomCredentialListCopy`. Those three routes decide on host-only state (how the request authenticated, or a pinned principal-less rejection), so they stay host hand-written; the custom create/delete and publish create/update/verify/delete specs are unchanged. `CustomCredentialProjectKeys` now only needs `use`.

`sourceControlProvidersRoute` no longer writes plugin load refusals to `console.warn`, and `SourceControlProviderRegistry` no longer has a `refusals` field: the host's provider loader reports them through its own log. The response never carried refusal text and still does not.
