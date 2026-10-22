# Credentialed HTTP

The approved extraction scope is credential-origin binding, HTTP authentication and redacted
results. Storage, sealing/AAD, workspace authorization, plugin discovery and human confirmation
are host responsibilities. There are no default plugin loaders, repositories or audit sinks.

```ts
const result = await makeCredentialedRequest(
  { deps: { resolver, httpClient, schemeRegistry, audit, clock },
    input: { workspaceId, label, method: "POST", url } },
  { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) },
);
```

`CredentialResolverPort.describe` returns metadata without decrypting. `resolve` returns
plaintext only inside the service. Implement both methods with the same workspace/label lookup.
`HttpClientPort` must enforce SSRF protection on every DNS/redirect hop, bounded response reads,
and credential stripping on cross-origin redirects; this module checks the initial saved origin.

`schemeRegistry.load({ workspaceId })` is required, including for hosts with no custom schemes
(return `[]`). `parseCredentialSchemesFile({ raw })` validates schema-v1 rule data and
`detectSelfDescribingAuthScheme({ token, rules })` applies first-prefix-match precedence.
The registry adapter owns trust, duplicate rules across contributions, and filesystem loading.
Self-describing schemes win over Basic; Basic wins over Bearer.

`audit.record` receives only label, host, method, status, request-body byte count and time.
Transport failures use status zero. Credential lookup/shape failures occur before transport and
retain their error behavior without an outbound audit entry. The audit adapter must not throw.

Optional `errorPolicy` recognizes and rethrows the host's egress refusal class. Its description
must be safe server-side diagnostics. Other transport messages are redacted before exposure.
Optional `diagnosticMapper({ diagnostic, status })` maps the neutral 401/403 facts to a host
remedy/issuer contract. There is no default tool id or issuer singleton. A Basic-auth hypothesis
appears only on Bearer 401, never 403. The host must preserve diagnostic authenticity/identity
when its recovery mechanism depends on that property.

All new public functions take a required object and at most one optional object. Bodies and
extra headers belong in argument two. No package version changed. Runtime/type/build/package
verification is pending by owner directive.

Transport contract: core `HttpClientPort.send({ request }, { redirect? })` receives the complete
request, including optional body, in argument one. Import the contract from
`@jini-ai/core/primitives`. Error constructors take `{ message }` and optional `{ options }`
for Error causes; message text is preserved.

Audit adapters implement `record({ entry })`; the entry DTO keeps its optional egress-refusal
field. `ConsoleCredentialedRequestAuditLog` requires `{ prefix, log }`, and calls `log({ line })`.
The line format and in-memory entry shape remain unchanged.
