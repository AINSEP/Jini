# Diagnostics API and migration

All public functions and factories accept a required-argument object followed, when needed, by an optional-settings object. Redaction export names are retained; the clock types now come from `@jini-ai/core/primitives`. The previous positional signatures have no compatibility wrappers.

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
