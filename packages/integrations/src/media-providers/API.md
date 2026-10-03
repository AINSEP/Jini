# Media outbound HTTP

`MediaDispatchEngineOptions`, `RenderContext`, and `OperationRuntimeDeps` extend
`MediaOutboundOptions`. Its `httpClient` is the existing `HttpClientPort` from
`@jini-ai/core/primitives`, constructed by `createHttpClient` from
`@jini-ai/platform/http/guarded`. Inject one policy-enforcing client at host composition; vendor
requests, signed submit/poll calls and parser asset downloads share it. The host is trusted to
supply a guarded client rather than a raw transport disguised as this port.

```ts
const engine = createMediaDispatchEngine({}, { credentials, httpClient });
const result = await engine.generate({ surface: 'image', model: 'dall-e-3' }, { prompt });
```

Omission selects native DNS/clock/pinned-transport ports. The default policy permits HTTP(S),
denies private, loopback, link-local and reserved peers, rejects URL credentials, and caps decoded
bytes at 96 MiB. Every DNS answer must be allowed, and the transport dials the checked IP while
preserving authority and TLS SNI. DNS errors and empty answers stop before connection.

All requests force `redirect: 'error'`, overriding request initialization and client follow defaults.
No redirected peer is contacted, including for a public redirect. `allowPrivateNetwork: true` is an
explicit development capability for the default client; it does not enable redirects or modify an
injected client's policy. A host may configure private access on its injected guarded client.

Generation keeps its ten-minute budget, asset downloads use two minutes, and polls use QUICK.
The same whole-operation deadline spans DNS and full decoded-body reads. Caller cancellation is
preserved. Binary response bytes come from the guarded response byte view, and clipping rejects
the artifact rather than returning a corrupt image/video.

Vendor requests support standard GET/HEAD/POST/PUT/PATCH/DELETE methods, string bodies and
URLSearchParams. Other body shapes fail before I/O. `requestInit.dispatcher` is rejected because it
can override the pinned socket. Configure connection behavior in the guarded-client adapter.

`OperationRuntimeDeps.fetchImpl` is removed. Use `httpClient` in the optional runtime arguments.
Runtime parsers inherit that client for follow-up asset downloads. Existing persistence, grace
window, lease and retry contracts remain unchanged.

The internal exported helper `bytesFromOpenAICompatibleData` now receives
`({ data, providerTag }, { requestInit?, httpClient?, allowPrivateNetwork? })`.
Base64-only responses require no network access.

`defaultMediaOutboundMessages` contains transport diagnostics. `outboundMessages` accepts host
overrides for method/body/dispatcher errors. Standalone DNS and URL validation use the default
diagnostics. The existing URL-validation functions remain exported, but URL validation alone is
not a connection-pinning guarantee; use `assertAndFetchExternalAsset` for downloads.
