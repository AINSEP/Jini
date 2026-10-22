# Integration contracts

Use `@jini-ai/core/primitives` for HttpClientPort, HttpRequest, HttpResponse, UUID,
ISODateTime, JsonValue/JsonObject, Clock and IdGenerator. HTTP sends are
`send({ request }, { redirect? })`; signed/credentialed body bytes stay inside `request`.
Webhook and credentialed HTTP services derive ISO timestamps with `nowIso({ clock })`
and accept `clock.nowMs()`. `CredentialedRequestDeps.clock` is the kernel `Clock`;
verification and request audit timestamps retain their existing sampling points.

Media dispatch and async-operation options accept `httpClient: HttpClientPort`; raw
`fetchImpl` injection is unsupported. The default guarded client pins DNS-validated
peers and refuses redirects. Host-injected clients must enforce the same policy.
Hostname classifiers come from `@jini-ai/platform/net`.

Catalog lookups use `findProvider({ id })`. Media DI tokens use core
`token<Port>({ id })`. `svgPlaceholder` requires the complete `RenderContext`
required fields in argument one and accepts its optional controls in argument two.
Native Node buffer writes retain their positional ABI.
