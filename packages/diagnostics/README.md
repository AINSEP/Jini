# `@jini-ai/diagnostics`

> **Current API:** the root functions use required-argument objects, separate optional settings and injected host ports. See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/diagnostics/API.md) for all signatures, current examples and the five new subpaths. The descriptions and Usage example retained below document the earlier positional API; use the migration guide for the current source. Root export names and the version remain unchanged, but the old call signatures require migration.

Builds a redacted support bundle: collect a list of log sources off disk, strip anything
secret-shaped out of them, add a manifest describing the machine and the app that produced them, and
zip the whole thing. Meant for the "export diagnostics" button in a desktop app or the
`/api/diagnostics/export` route in a daemon — the two surfaces that otherwise reimplement the same
redaction pass and get it subtly different. Shared clocks and credential patterns come from `@jini-ai/core`; archive creation uses `jszip`.

## Install

```sh
npm install @jini-ai/diagnostics
```

No peer dependencies. `jszip` is a regular dependency (pure JS — no native compile), installed
automatically.

## What you get

**The one-call export** — `buildDiagnosticsZip(input)` → `{ zip: Buffer, manifest, machineInfo }`.
`DiagnosticsExportInput` takes a `DiagnosticsContext`, the `LogSource[]` to collect, optional
`RedactionOptions`, and an optional `CrashReportLookup` that adds matching macOS crash reports to the
bundle. A source that fails to read becomes a placeholder file inside the zip rather than failing the
whole export.

**Redaction** — `redactText`, `redactJsonText`, and `redactJsonValue` (walks a parsed structure,
redacting secret-shaped keys and values), with `RedactionOptions` carrying an optional `username` to
scrub from paths. This is the part that must not be reimplemented per surface.

**Log-source collection** — `LogSource` (`{ name, absolutePath, kind: 'json' | 'text', tailBytes? }`),
`LogSourceKind`, `CollectedFile`, with `collectLogSource` (one) and `collectLogSources` (many), plus
`findMacOSCrashReports(lookup)`. Two higher-level builders turn domain concepts into sources:
`buildRunEventLogSources` and `buildAgentCliLogSources(options)` (coding-agent CLI logs, via
`AgentCliLogOptions`).

**Manifest** — `buildManifest`, `buildMachineInfo`, and `diagnosticsFileName(prefix, now?)`, with
`DiagnosticsManifest` / `DiagnosticsContext` / `DiagnosticsAppInfo` / `MachineInfo`.
`DiagnosticsContext` carries `app` plus a `source` naming which surface triggered the export
(`'daemon-http'`, `'desktop-ipc'`, …) and an optional `warnings` array, so "file logs are unavailable
in this launch mode" surfaces as a real note instead of fake missing-file entries.

**Transport constants** — `DIAGNOSTICS_EXPORT_PATH`, `DIAGNOSTICS_CONTENT_TYPE`, and
`DIAGNOSTICS_FILENAME_PREFIX`, so an HTTP route and its client agree on the endpoint and the
download filename without either hardcoding a string.

## Usage

```ts
import {
  buildDiagnosticsZip,
  DIAGNOSTICS_CONTENT_TYPE,
  DIAGNOSTICS_FILENAME_PREFIX,
  diagnosticsFileName,
  redactText,
  type LogSource,
} from '@jini-ai/diagnostics';

const sources: LogSource[] = [
  { name: 'logs/daemon.log', absolutePath: '/var/log/example/daemon.log', kind: 'text' },
  { name: 'logs/events.json', absolutePath: '/var/log/example/events.json', kind: 'json', tailBytes: 512_000 },
];

const { zip, manifest } = await buildDiagnosticsZip({
  context: {
    app: { name: 'example', version: '1.2.3', packaged: true },
    source: 'daemon-http',
    endpoint: 'http://127.0.0.1:4173',
  },
  sources,
  redaction: { username: 'alice' },
  crashReports: { matchSubstrings: ['example'], withinDays: 7, maxReports: 20 },
});

// e.g. from an Express handler
res.setHeader('Content-Type', DIAGNOSTICS_CONTENT_TYPE);
res.setHeader(
  'Content-Disposition',
  `attachment; filename="${diagnosticsFileName(DIAGNOSTICS_FILENAME_PREFIX)}"`,
);
res.end(zip);

// Or use the redactor on its own, before logging something.
const safe = redactText('Authorization: Bearer sk-live-abc123');
```

## What's swappable

None of the redaction rules — that is deliberate. `RedactionOptions` carries only a `username` to
scrub from paths; the secret-key and secret-value patterns are fixed, because a bundle that redacts
less than another surface's bundle is a leak, and a per-caller override is exactly how that drift
starts. What *is* yours: the `LogSource[]` (which files end up in a bundle is entirely your decision,
and `buildRunEventLogSources` / `buildAgentCliLogSources` are conveniences rather than a required
path) and every field of `DiagnosticsContext`. There are no DI tokens and no injected filesystem —
collection uses `node:fs` directly.

## Wiring

`@jini-ai/diagnostics/console-tee` (architecture: [`extraction-plan.md`](../../ADS-memory/reports/jini-port/extraction-plan.md)).

- **Needs injected:** a `ConsoleTeeBuffer` (for `installConsoleTee`); for `createRedactedOutputSink`, the parent
  sink (`Pick<Writable, "write">`), the host's `redact` function, and optionally a shared
  `RetainedOutputTail` record plus `tailKeepChars`, `maxLength`, `maxLineLength` and a `CaptureFailureReporter`.
- **Provides:** a line-framed child-output writable that redacts before anything is mirrored or retained, and keeps
  a bounded, interleaved tail of all of one child's streams for a boot-failure message.
- **Never imports:** a host logger or console formatter, product names or CLI wording, or any other `@jini-ai/*`
  implementation. Failure copy (what to call the child, how to parse its error line) stays in the host.

```ts
import { createRedactedOutputSink } from "@jini-ai/diagnostics/console-tee";

const state = { outputTail: "" }; // read by the host's failure message
for (const stream of ["stdout", "stderr"] as const) {
  child[stream].pipe(createRedactedOutputSink(
    { sink: process[stream], redact: ({ text }) => hostRedact({ text }) },
    { maxLength: 2_000, retain: state, tailKeepChars: 16_384 },
  ));
}
```

## Runtime

`jini.runtime: "node"` — reads real files via `node:fs`, and `buildMachineInfo` reads `node:os`.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See the archived provenance ledger for per-file provenance and scope decisions. Apache-2.0,
inherited from Open Design — see the repo `NOTICE`.

See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/diagnostics/API.md) for the additive redaction, observability, web-evidence and domain-dns subpaths and host adapter contracts.

## Design decisions

- [Build evidence URLs from verified host configuration](docs/decisions/DR-001-trusted-evidence-addresses.md).

Bundle collection, inbound request hooks and web evidence share `Clock` from `@jini-ai/core/primitives` (`nowMs()` with no empty argument); the old package-local clock types are removed. Credential regexes come only from core's eleven-entry `SECRET_SHAPE_PATTERNS`; diagnostics keeps its own redaction policies and existing scanner/redactor export names. See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/diagnostics/API.md) for migration details.

## Wiring

**Global error reporting** (`installGlobalErrorReporting` from `./observability`). The host injects
`target` (its `window`) and `report` — its own sink that maps `{ message, stack }` onto its telemetry
vocabulary (payload kind, IPC channel, bridge) and swallows bridge failures. Optional
`maxMessageLength`/`maxStackLength`/`rejectionFallback` override the 1000/8000/"Unhandled rejection"
defaults. The host's renderer boot module calls it once before the UI mounts and keeps the teardown
for tests.
