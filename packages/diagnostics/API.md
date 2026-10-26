# Diagnostics API and migration

Public standalone functions and factories accept a required-argument object followed, when needed, by an optional-settings object. Tracker methods follow the same required/optional object rule. Redaction export names are retained; the clock types now come from `@jini-ai/core/primitives`. The previous positional signatures have no compatibility wrappers.

## Root bundle API

| Function | Required arguments | Optional settings (argument two) |
|---|---|---|
| `redactJsonValue` | `{ value }` | `{ username }` |
| `redactJsonText`, `redactText` | `{ text }` | `{ username }` |
| `collectLogSource` | `{ source, filesystem }` | `{ username }` |
| `collectLogSources` | `{ sources, filesystem }` | `{ username }` |
| `findMacOSCrashReports` | `{ matchSubstrings, filesystem, clock, system }` | `{ withinDays, maxReports, searchDirs, homeDir }` |
| `buildManifest` | `{ context, files, clock }` | — |
| `buildMachineInfo` | `{ system }` | `{ username }` |
| `diagnosticsFileName` | `{ prefix, clock }` | `{ now }` |
| `buildDiagnosticsZip` | `{ context, sources, filesystem, clock, system, archiveFactory }` | `{ redaction, crashReports, crashReportOptions }` |
| `buildRunEventLogSources` | `{ runsDir, filesystem }` | `{ maxRuns, tailBytes }` |
| `buildAgentCliLogSources` | `{ homeDir, filesystem }` | `AgentCliLogOptions` |
| `createNodeDiagnosticsPorts` | `{}` | — |

The root exports `DiagnosticsPorts` and its filesystem, system, archive and archive-factory interfaces. `DiagnosticsPorts.clock` is core `Clock` (`nowMs()`); other port methods take objects. Hosts may implement those interfaces directly or explicitly opt into the Node/JSZip adapter. Each archive-factory invocation creates a fresh archive. Core bundle collection reads no ambient filesystem, clock or machine snapshot. Missing files produce placeholder entries and manifest warnings.

```ts
import {
  buildDiagnosticsZip, createNodeDiagnosticsPorts, diagnosticsFileName,
  DIAGNOSTICS_CONTENT_TYPE, DIAGNOSTICS_FILENAME_PREFIX, redactText,
  type LogSource,
} from '@jini-ai/diagnostics';

const ports = createNodeDiagnosticsPorts({});
const sources: LogSource[] = [
  { name: 'logs/daemon.log', absolutePath: '/var/log/example/daemon.log', kind: 'text' },
];
const { zip, manifest } = await buildDiagnosticsZip({
  ...ports,
  context: { app: { name: 'example', version: '1.2.3' }, source: 'daemon-http' },
  sources,
}, {
  redaction: { username: 'alice' },
  crashReports: { matchSubstrings: ['example'] },
  crashReportOptions: { withinDays: 7, maxReports: 20, homeDir: '/Users/alice' },
});
const filename = diagnosticsFileName({ prefix: DIAGNOSTICS_FILENAME_PREFIX, clock: ports.clock });
const contentType = DIAGNOSTICS_CONTENT_TYPE;
const safe = redactText({ text: 'Authorization: Bearer example123456' });
// The host sends zip with contentType and filename and may inspect manifest.
```

## New subpaths

| Subpath | Runtime | Public behavior |
|---|---|---|
| `redaction/secrets-only` | universal | `redactSecretShapes({ text, policy })`; also exports `SECRET_PATTERNS`, `PEM_PATTERN_NAME` and policy/rule types. Preserves paths and ordinary error prose. |
| `observability` | universal | Explicit configuration, no-op/tracing factories and request hooks; exports structural SDK, logger, metrics and request-ID ports; clocks use core `Clock`. |
| `web-evidence` | universal | Bounded observation collector, same-origin helpers, browser/origin/policy ports and browser-serialized DOM structure capture. DOM capture itself runs in a page. |
| `web-evidence/playwright` | node | Optional adapter opened with `openPlaywrightSiteEvidenceBrowser({}, options)`. Core evidence imports never load Playwright. |
| `domain-dns` | node | Hostname validators, record types, `DomainDnsInputError` and `createDomainDnsChecks(deps)`, over injected authorization, resolver, TLS and expected-host ports. |

```ts
import { redactSecretShapes } from '@jini-ai/diagnostics/redaction/secrets-only';
import { resolveObservabilityConfig, createNoopObservabilityPort } from '@jini-ai/diagnostics/observability';
const safeError = redactSecretShapes({ text: 'password=example-secret', policy: {} });
const config = resolveObservabilityConfig(
  { serviceName: 'example-service', tracerName: 'example-http' },
  { endpoint: 'https://collector.example.com' },
);
const disabledTracking = createNoopObservabilityPort({});
```

Application credential formats belong in required `policy.additionalRules`; rule replacements receive `{ match }` and must be idempotent. Secret-only redaction and the root bundle redactor intentionally retain different policies. Telemetry configuration never reads environment variables. Enabled telemetry requires exporter/provider factories supplied by the host; request hooks require clock and ID ports and accept logger, metrics and tracing ports in argument two.

`collectPageEvidence({ workspaceId, originRegistry, openBrowser, observationPolicy, paths }, options)` requires the host's redaction policy. `options` may supply clock, consent selector and accessibility settings. The origin port takes `{ workspaceId }`, the browser factory takes `{}`, and browser methods take `observe(request, options)` and `close({})`. Same-origin helpers take `{ raw }`, `{ origin }`, `{ baseUrl, path }` and `{ baseUrl, candidateUrl }`. `collectPageStructure(limits)` takes an object of required bounds and runs inside the browser; its body must stay self-contained for serialization.

`openPlaywrightSiteEvidenceBrowser({}, { moduleLoader, launchOptions })` accepts a structural loader port. With no loader it dynamically loads the host's optional `playwright` installation; missing library or browser yields an availability result. This package adds no Playwright dependency and performs no browser installation.

`readPublicDomain({ value, errorPrefix })` and `readPublicDnsName({ value, errorPrefix })` validate before network effects. `createDomainDnsChecks({ authorize, resolver, listExpectedHosts, probeTls })` returns `lookupDns({ domain }, { types }?)`, `checkDns({ domain }, { expectedHost }?)` and `tlsStatus({ domain })`. Transport adapters must enforce public-only egress. CMS registration, HTTP middleware, permission names and environment configuration remain host adapters.

## Verification status

This integration pass did not run tests, typechecks, builds or packing, per owner directive. The repository's `integration-diagnostics-report.md` records exact deferred commands and the application rewire ledger. There are no new dependencies or lockfile requirements.

## Shared clock and redaction contracts

Import `Clock` from `@jini-ai/core/primitives`; `ClockPort` and `DiagnosticsClockPort` are removed. Bundle collection, request hooks and evidence collection all use `clock.nowMs()` without an empty argument. `RequestIdGenerator.generate({})` stays request-scoped: hosts can preserve inbound correlation-ID policy independently of their domain ID generators.

`redactSecretShapes`, `redactText`, `redactJsonValue` and `redactJsonText` retain their argument and result shapes. `SECRET_PATTERNS`, `PEM_PATTERN_NAME` and `SecretPattern` remain available from `./redaction/secrets-only` as the existing scanner vocabulary backed by core's `SECRET_SHAPE_PATTERNS`. All eleven regex sources remain unchanged. Diagnostics imports the catalog only, preserving its own replacement and disclosure policies; it never calls core `redactSecrets`. Root text/JSON bundle redaction now also catches the eleven standalone credential formats, while identifiers, hashes, paths and model names remain readable.

Off-origin redirect messages identify "the inspected origin"; the origin boundary and discarded-content behavior are unchanged.

## Tracker facade

`createTracker` from `@jini-ai/diagnostics/observability/node` composes optional existing
`ProductAnalyticsPort` and `ObservabilityPort` providers. `Tracker` and `createNoopTracker`
are available from the universal `observability` entry. Supply analytics after the existing
consent guard and site attribution have been applied; the facade does not apply them twice.

```ts
const tracker = createTracker({ productAnalytics, observability }, { warn });
tracker.capture({ name: "post_created", userId }, { properties });
tracker.error({ error }, { context: { route: "/posts/:id" } });
const result = await tracker.trace({ name: "deploy", run: async (span) => {
  const result = await deploy();
  span.setOutcome({ outcome: "published", failed: false });
  return result;
} }, { attributes: { target: "production" } });
tracker.metric({ name: "publish.duration", value: 150 }, { kind: "histogram", unit: "ms" });
tracker.metric({ name: "queue.size", value: 3 }); // gauge by default
```

Missing providers are inert. Provider faults are contained and emit one fixed warning per
facade; provider error text is never logged. Callback failures still reject with the original
application error, reported through the existing redaction/deduplication owner. Deduplication is
scoped to a tracker instance and request/trace occurrence, and starts only after at least one
provider accepts the report. Failed/noop delivery remains retryable; unscoped calls are independent.
The optional second `trace` argument selects the existing lifecycle: `{ request: { method, path,
requestId? } }`, `{ agent: { runId, conversationId?, agentName? } }`, or operation attributes.
Overloads give each callback its corresponding typed `setOutcome` payload. The facade ends
the lifecycle after the callback settles; its first explicit outcome wins unless the callback
throws, which overrides success with failure. Canceled, interrupted and explicit failure
outcomes keep their own labels.


`capture` keeps the analytics port's required `userId`: consent and pseudonymous identity remain
owned by that port. Event `properties` belong to the optional second object. `error` takes the
error in the required object and its optional `context` in the second. Old positional signatures
have no aliases or compatibility wrappers.

`metric({ name, value }, { kind?, unit?, attributes? })` fans out through `ObservabilityPort.metric`.
Kinds are `counter` (increments), `gauge` (latest value, the default), and `histogram` (distribution).
Names, units and attribute keys/values must be fixed, low-cardinality labels; never pass user text.
Missing providers and no-op helpers discard measurements. Throwing/rejecting providers are isolated.
The diagnostic test probe sends a counter and includes a `metric` receipt only when that
provider declares `supportsMetric: true`; callable noop methods do not imply acceptance.

The OpenTelemetry provider plugin lazily starts a private SDK meter on the first finite measurement.
It exports OTLP/HTTP JSON to the configured collector base plus `/v1/metrics`, independently of a
`tracesEndpoint` override. Direct adapter callers use the trace URL with `/v1/traces`
replaced by `/v1/metrics` unless they supply the shared collector base in `options.endpoint`;
a custom trace-only path falls back to `/v1/metrics` at the same origin.
Headers/auth, service identity and resource attribution are shared with tracing; no environment
credentials or global meter registration are used. Export happens every 60 seconds and at disposal,
with a 30-second export timeout; disposal stops both pipelines. `metricReaders` replaces the default
metrics exporter for tests (including `[]` to suppress export). Non-finite values and metric
names longer than 255 characters are ignored. Attributes admit at most 64 bounded label keys;
operation/metric string values retain the 256-character redaction cap. OTel spans also enforce
64 attributes and 1,024-character string values at the SDK boundary. Request targets prefer
route templates; unmatched paths strip query/fragment and replace id/email/token-like segments.
The shared helper takes `redactRequestTarget({ path }, { routePattern? })`.
Sentry inherits the no-op measurement method: its configured adapter owns errors and traces.
PostHog only registers product analytics, so metrics are no-ops for that plugin; measurements are
never recast as product events and do not bypass the existing analytics consent owner.
