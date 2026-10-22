Spec ID: SPEC-JINI-DIAGNOSTICS-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:5619379bf59dcf103e8ae1a4a5a337d321f2279e9db58b60463b102b733e420c
spec_mode: reverse_spec


# Diagnostics API contract

Scope: all six `package.json` exports. Signatures below describe current source. Required inputs occupy the first object; optional settings occupy the second object with `{}` as default where implemented. Required-only functions currently have one argument; do not pass an invented options object. Clocks use core `Clock`; request correlation IDs retain their dedicated generator.

## Root: `@jini-ai/diagnostics`

| Entry point | Current signature and return |
|---|---|
| `redactJsonValue` | `({ value: unknown }, optional: RedactionOptions = {}) => unknown` |
| `redactJsonText`, `redactText` | `({ text: string }, optional: RedactionOptions = {}) => string` |
| `collectLogSource` | `({ source: LogSource, filesystem }, optional: RedactionOptions = {}) => Promise<CollectedFile>` |
| `collectLogSources` | `({ sources: LogSource[], filesystem }, optional: RedactionOptions = {}) => Promise<CollectedFile[]>` |
| `findMacOSCrashReports` | `({ matchSubstrings: string[], filesystem, clock, system }, optional: CrashReportOptions = {}) => Promise<LogSource[]>` |
| `buildManifest` | `({ context: DiagnosticsContext, files: CollectedFile[], clock }) => DiagnosticsManifest` |
| `buildMachineInfo` | `({ system }, optional: { username?: string } = {}) => MachineInfo` |
| `diagnosticsFileName` | `({ prefix: string, clock }, optional: { now?: Date } = {}) => string` |
| `buildDiagnosticsZip` | `({ context, sources, filesystem, clock, system, archiveFactory }, optional: DiagnosticsExportOptions = {}) => Promise<{ zip: Buffer; manifest: DiagnosticsManifest; machineInfo: MachineInfo }>` |
| `buildRunEventLogSources` | `({ runsDir: string | null | undefined, filesystem }, optional: { maxRuns?: number; tailBytes?: number } = {}) => Promise<LogSource[]>` |
| `buildAgentCliLogSources` | `({ homeDir: string, filesystem }, optional: AgentCliLogOptions = {}) => Promise<LogSource[]>` |
| `createNodeDiagnosticsPorts` | `({}) => DiagnosticsPorts` |

`RedactionOptions = { username?: string }`. `LogSource = { name: string; absolutePath: string; kind: 'json' | 'text'; tailBytes?: number }`. `CollectedFile` adds `content: string | null`, original `bytes: number`, and optional `error: string` to name/path.

`DiagnosticsContext` requires `app: { name; version?; channel?; packaged? }` and `source: string`; optional fields: `namespace`, `endpoint`, `daemonReachable`, `extra: Record<string, unknown>`, `warnings: string[]`. `DiagnosticsManifest` carries `exportedAt`, context metadata, ordered file metadata `{ name, absolutePath, bytes, error? }`, and warnings. `MachineInfo` carries hostname, platform, release, arch, type, totalMemoryBytes, nodeVersion, pid, ppid, cwd and optional username.

`CrashReportLookup = { matchSubstrings: string[] }`; `CrashReportOptions` permits `withinDays`, `maxReports`, `searchDirs`, `homeDir`. `DiagnosticsExportInput` combines context/sources with all `DiagnosticsPorts`; `DiagnosticsExportOptions` permits `redaction`, `crashReports`, `crashReportOptions`. `AgentCliLogOptions` permits `dataDir`, `amrOpenCodeHome`, `claudeConfigDir`, `codexHome`, `xdgDataHome`, `maxFilesPerAgent`, `tailBytes`.

Exported aliases: `DiagnosticsAppInfo` names context.app; `LogSourceKind` is json|text; `DiagnosticsExportResult` names zip/manifest/machineInfo. `ObservabilityConfigDisabled` names enabled:false; `NormalizeSitePathResult` names the normalization result union; `ObservePageOptions` permits consentAcceptSelector; `SkippedPageReason` names the skipped evidence reason union in [errors.spec.md](errors.spec.md).

Consumer ports (also exported):

| Port | Methods the consumer supplies |
|---|---|
| `DiagnosticsFilesystemPort` | `readFile({ absolutePath }, { tailBytes? }?) => Promise<Buffer>`; `readDirectory({ absolutePath }) => Promise<{ name; isDirectory }[]>`; `stat({ absolutePath }) => Promise<{ isFile; mtimeMs }>` |
| `Clock` from core/primitives | `nowMs() => number` in epoch milliseconds |
| `DiagnosticsSystemPort` | `platform({}) => string`; `machineInfo({}) => Omit<MachineInfo, 'username'>` |
| `DiagnosticsArchivePort` | `file({ name, content: string }) => void`; `generate({}) => Promise<Buffer>` |
| `DiagnosticsArchiveFactoryPort` | `create({}) =>` a fresh `DiagnosticsArchivePort` |
| `DiagnosticsPorts` | `{ filesystem, clock, system, archiveFactory }` |

Constants: `DIAGNOSTICS_EXPORT_PATH = '/api/diagnostics/export'`, `DIAGNOSTICS_CONTENT_TYPE = 'application/zip'`, `DIAGNOSTICS_FILENAME_PREFIX = 'jini-diagnostics'`. They do not register an HTTP endpoint.

```ts
import { buildDiagnosticsZip, createNodeDiagnosticsPorts } from '@jini-ai/diagnostics';
const bundle = await buildDiagnosticsZip({
  ...createNodeDiagnosticsPorts({}),
  context: { app: { name: 'SupportHost' }, source: 'operator' },
  sources: [{ name: 'logs/runtime.log', absolutePath: '/srv/logs/runtime.log', kind: 'text' }],
});
// bundle.zip is ready for the host's download transport.
```

## `./redaction/secrets-only`

`redactSecretShapes({ text: string, policy: RedactionPolicy }) => SecretRedaction`, where result is readonly `{ text: string; redactions: number }`. `RedactionPolicy = { additionalRules?: readonly RedactionRule[] }`; each `RedactionRule` has `kind`, `pattern: RegExp`, and `replacement({ match: readonly (string | undefined)[] }) => string`. Custom rules must be idempotent. `SECRET_PATTERNS` is an ordered readonly `SecretPattern[]` (`name`, `pattern`); `PEM_PATTERN_NAME` names the PEM rule. No filesystem or transport port is required.

```ts
import { redactSecretShapes } from '@jini-ai/diagnostics/redaction/secrets-only';
const safe = redactSecretShapes({ text: 'password=hunter2hunter2', policy: {} });
```

## `./observability`

| Entry point | Current signature and return |
|---|---|
| `resolveObservabilityConfig` | `({ serviceName: string, tracerName: string }, optional: { endpoint?: string; tracesEndpoint?: string } = {}) => ObservabilityConfig` |
| `createObservabilityPort` | `({ config, exporterFactory, tracerProviderFactory }) => ObservabilityPort` |
| `createOtelObservabilityPort` | `({ config: ObservabilityConfigEnabled, exporterFactory, tracerProviderFactory }: OtelAdapterDependencies) => ObservabilityPort` |
| `createNoopObservabilityPort` | `({}) => ObservabilityPort` |
| `createHookObservabilityPort` | `({ clock: Clock, requestIdGenerator: RequestIdGenerator }, optional: RequestHookOptions = {}) => ObservabilityPort` |

`ObservabilityConfig` is `{ enabled: false }` or `{ enabled: true; serviceName; tracerName; endpoint }`. `ObservabilityPort.trackRequest({ method, path }, { requestId? }?) => RequestTracker`; `RequestTracker` has optional `requestId` and `end({ statusCode, routePattern }) => void`. `RequestTrackingInput`, `RequestTrackingOptions`, `RequestTrackingOutcome` name those objects. `RequestObservation` adds `requestId`, `method`, `durationMs` to outcome.

`RequestHookOptions` supplies optional `logger: RequestLogPort.log(event)`, `metrics: RequestMetricsPort.recordRequest(event)`, and `tracing: ObservabilityPort`. `Clock.nowMs() => number`; `RequestIdGenerator.generate({}) => string`. `ExporterFactory.create({ endpoint }) => unknown`; `TracerProviderFactory.create({ serviceName, exporter }) => TracerProviderPort`; provider `getTracer({ name }) => TracerPort`. Tracer `startSpan({ name, kind: 'server', attributes }) => TraceSpanPort`; span methods: `updateName({ name })`, `setAttribute({ name, value: string | number })`, `setStatus({ code: 'error' })`, `end({})`. All are synchronous. Host SDK wrappers supply these effects.

```ts
import { createHookObservabilityPort } from '@jini-ai/diagnostics/observability';
const tracking = createHookObservabilityPort({ clock, requestIdGenerator }, { logger });
tracking.trackRequest({ method: 'GET', path: '/items/123' }).end({ statusCode: 200, routePattern: '/items/:id' });
// clock, requestIdGenerator and logger are host-owned port implementations.
```

## `./web-evidence`

| Entry point | Current signature and return |
|---|---|
| `collectPageEvidence` | `({ workspaceId, paths: readonly string[], originRegistry, openBrowser, observationPolicy }, optional: CollectPageEvidenceOptions = {}) => Promise<SiteEvidenceResult>` |
| `normalizeSitePath` | `({ raw: string }) => { ok: true; path: string } | { ok: false; reason: SitePathRejectionReason; message: string }` |
| `verifiedOriginToBaseUrl` | `({ origin: VerifiedOrigin }) => string` |
| `resolveSameOriginUrl` | `({ baseUrl: string, path: string }) => string` |
| `isSameOriginUrl` | `({ baseUrl: string, candidateUrl: string }) => boolean` |
| `collectPageStructure` | `(limits: PageStructureLimits) => PageStructureCapture` (one object; requires browser DOM globals) |

`VerifiedOrigin = { scheme: 'http' | 'https'; host: string; port?: number; basePath?: string; verifiedAt: string; source: string }`; `VerifiedOriginPort.canonicalOrigin({ workspaceId }) => Promise<VerifiedOrigin>`. `SiteEvidenceBrowserFactory({})` returns `{ available: false; reason }` or `{ available: true; browser: SiteEvidenceBrowserPort }`. Browser methods: `observe(request: ObservePageRequest, { consentAcceptSelector? }?) => Promise<ObservePageResult>`; `close({}) => Promise<void>`. Request requires url, originBaseUrl, collectAccessibility, timeoutMs and every per-category limit from `SITE_EVIDENCE_LIMITS`. Result is `{ ok: false; reason }` or `{ ok: true; observation: PageObservation }`.

`CollectPageEvidenceDeps` requires workspaceId and all three ports. `ObservationPolicy` supplies synchronous `redactObservation({ observation }) => PageObservation` and `redactMessage({ message }) => string`. Optional collection settings: `clock.nowMs()`, `consentAcceptSelector`, `collectAccessibility`.

`SiteEvidenceResult` contains schemaVersion `'1'`, collectedAt, origin, browser availability, consentTransition, limits, pages, skipped, disclaimer. `PageEvidence` pairs path/url with `PageObservation`; `SkippedPage` has path/reason/message. `BrowserAvailabilityReport` and `ConsentTransitionReport` are discriminated unions. `ObservationPhase = 'before' | 'after'`. `PageObservation` requires document, cookies, requests, notes and optional accessibility. Exported evidence types: `CookieEvidence` (name/domain/path, flags, expiry, firstParty, phase; no value), `RequestEvidence` (method/host/pathname/resourceType/firstParty/phase/blockedReason?), `HeaderEvidence`, `DocumentEvidence` (status/finalUrl/redirected/title/lang/headers/textExcerpt/textTruncated), `AccessibilityEvidence`, `LandmarkEvidence`, `HeadingEvidence`, `ImageEvidence`, `FormControlEvidence`, `ContrastSampleEvidence`. Accessibility reports bounded lists and category truncation, never a verdict.

`PageStructureLimits` requires maxTextExcerptChars, maxNodesPerCategory, maxContrastSamples, collectAccessibility. `PageStructureCapture` contains title/lang/textExcerpt/textTruncated/accessibility. `SITE_EVIDENCE_LIMITS` and `SITE_EVIDENCE_DISCLAIMER` are public constants; reason unions are specified in [errors.spec.md](errors.spec.md).

```ts
import { collectPageEvidence } from '@jini-ai/diagnostics/web-evidence';
const evidence = await collectPageEvidence({ workspaceId: 'workspace-1', paths: ['/'], originRegistry, openBrowser, observationPolicy });
// Supply verified-origin lookup, bounded browser and host redaction ports.
```

## `./web-evidence/playwright`

`openPlaywrightSiteEvidenceBrowser({}, optional: PlaywrightAdapterOptions = {}) => Promise<SiteEvidenceBrowserAvailability>`. Options: `moduleLoader.load({ moduleName: string }) => Promise<PlaywrightLike>` and `launchOptions: { headless?: boolean; args?: string[] }`. `PlaywrightLike` structurally describes Chromium launch, browser/context/page/route/cookie operations. Default loader dynamically imports `playwright`; browser availability includes launch failures. Host installs Chromium independently.

```ts
import { openPlaywrightSiteEvidenceBrowser } from '@jini-ai/diagnostics/web-evidence/playwright';
const capability = await openPlaywrightSiteEvidenceBrowser({});
if (capability.available) await capability.browser.close({});
```

## `./domain-dns`

`DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS']`; `DnsRecordType` is its element union. `readPublicDomain({ value: unknown, errorPrefix: string }) => string` validates hostnames; `readPublicDnsName` has the same signature and permits underscore owner labels. `DomainDnsInputError` has constructor `({ message: string })` and no code.

`createDomainDnsChecks(deps: DomainDnsDependencies) => DomainDnsChecks`. Required ports: `authorize({ operation: DomainDnsOperation }) => Promise<void>`, `resolver: PublicDnsResolver.query({ domain, type }) => Promise<DnsQuery>`, `listExpectedHosts({}) => Promise<string[]>`, `probeTls({ domain }) => Promise<TlsStatus>`. Operations are `'lookup-dns' | 'check-dns' | 'tls-status'`. Resolver must use public DNS; expected hosts must come from saved independent hosting configuration.

| Returned operation | Signature and return |
|---|---|
| `lookupDns` | `({ domain: unknown }, { types?: unknown } = {}) => Promise<{ domain; resolver: 'public-dns'; untrusted: true; queries: DnsQuery[] }>` |
| `checkDns` | `({ domain: unknown }, { expectedHost?: unknown } = {}) => Promise<unknown-result | comparison-result>`; unknown has domain/status/expectedHost/reason/untrusted; comparison adds expected/observed/unexpected/missing address sets, expectationSource and limitation |
| `tlsStatus` | `({ domain: unknown }) => Promise<TlsStatus & { domain; certificate: { expiresAt: null; issuer: null }; limitation: string }>` |

`DnsQuery = { type; status: 'ok' | 'not-found' | 'no-data'; records: { value: string; ttl: number }[] }`; `TlsStatus = { status: 'verified' | 'invalid' | 'unavailable'; httpStatus: number | null }`.

```ts
import { createDomainDnsChecks } from '@jini-ai/diagnostics/domain-dns';
const checks = createDomainDnsChecks({ authorize, resolver, listExpectedHosts, probeTls });
const answers = await checks.lookupDns({ domain: 'example.com' }, { types: ['A', 'AAAA'] });
```

Evidence: export barrels, implementations and inspected tests in `src/__tests__/`; tests were read, not executed. This snapshot does not claim a standardized second argument for APIs that lack one.

## Current manifest boundary

The current `package.json` exposes `.`, `./redaction/secrets-only`, `./observability`, `./web-evidence`, `./web-evidence/playwright`, `./domain-dns`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
