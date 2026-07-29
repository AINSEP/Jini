# `@jini-ai/diagnostics`

Builds a redacted support bundle: collect a list of log sources off disk, strip anything
secret-shaped out of them, add a manifest describing the machine and the app that produced them, and
zip the whole thing. Meant for the "export diagnostics" button in a desktop app or the
`/api/diagnostics/export` route in a daemon — the two surfaces that otherwise reimplement the same
redaction pass and get it subtly different. Zero `@jini-ai/*` dependencies; its only runtime
dependency is `jszip`.

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

## Runtime

`jini.runtime: "node"` — reads real files via `node:fs`, and `buildMachineInfo` reads `node:os`.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and scope decisions. Apache-2.0,
inherited from Open Design — see the repo `NOTICE`.
