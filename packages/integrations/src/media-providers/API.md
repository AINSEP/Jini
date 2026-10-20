# Media outbound HTTP

`RenderContext` and `OperationRuntimeDeps` carry `MediaOutboundOptions`. The engine requires
`{ registry, httpClient }` as its first argument; credentials and behavioral options stay second. The client is the existing `HttpClientPort` from
`@jini-ai/core/primitives`, constructed by `createHttpClient` from
`@jini-ai/platform/http/guarded`. Inject one policy-enforcing client at host composition; vendor
requests, signed submit/poll calls and parser asset downloads share it. The host is trusted to
supply a guarded client rather than a raw transport disguised as this port.

```ts
import { createBuiltinVendorAdapterRegistry, createMediaDispatchEngine } from '@jini-ai/integrations/media-providers';
import { createNodeMediaHttpClient } from '@jini-ai/integrations/media-providers/node';

const registry = createBuiltinVendorAdapterRegistry();
const httpClient = createNodeMediaHttpClient({});
const engine = createMediaDispatchEngine({ registry, httpClient }, { credentials });
const result = await engine.generate({ surface: 'image', model: 'dall-e-3' }, { prompt });
```

No media path constructs a client implicitly: missing clients fail before network I/O.
`fetchMediaOutbound({ url, timeoutMs }, { httpClient, init? })` requires the injected port.
The explicit Node adapter selects native DNS/clock/pinned-transport ports. Its policy permits HTTP(S),
denies private, loopback, link-local and reserved peers, rejects URL credentials, and caps decoded
bytes at 96 MiB. Every DNS answer must be allowed, and the transport dials the checked IP while
preserving authority and TLS SNI. DNS errors and empty answers stop before connection.

All requests force `redirect: 'error'`, overriding request initialization and client follow defaults.
No redirected peer is contacted, including for a public redirect. `allowPrivateNetwork: true` is an
explicit development capability in `createNodeMediaHttpClient({}, { allowPrivateNetwork: true })`;
it does not enable redirects. The legacy flag on engine/render/runtime options is deprecated and
cannot modify an injected client's policy. A host may configure private access on its injected guarded client.

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

Registry ownership is per host. `createVendorAdapterRegistry()` starts empty;
`createBuiltinVendorAdapterRegistry()` delegates population to the existing builtin-registration
owner. Engines use only the injected lookup, including registrations made after construction.
The shared `mediaVendorRegistry` remains exported for compatibility but is deprecated and never
read by engines. Duplicate keys still throw within a registry; separate registries may use the same key.

Standalone renderers, parser downloads and async operation runtimes retain their existing signatures
but require `httpClient` when performing network I/O. Base64 and pure context helpers still work
without a client. DNS overrides now belong on the explicit client adapter; the legacy asset-helper
`lookup` option remains accepted for source compatibility and cannot override the client's resolver.
