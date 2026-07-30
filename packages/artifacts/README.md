# `@jini-ai/artifacts`

A store for the files an agent produces during a run — an HTML page, a Markdown doc, an SVG — with the
guard rails that make those files safe to show and safe to publish. Every artifact carries a validated
manifest, so a renderer knows what it is looking at; a publication guard refuses to ship content still
full of placeholder text; a stub guard catches the regression where a re-run replaces a real artifact
with a near-empty one; and a text suppressor keeps artifact markup out of the visible chat stream
while it is still being written. The root entry point is pure decision logic and types — Node-only
disk scanning lives behind `./node`.

## Install

```sh
npm install @jini-ai/artifacts
```

No peer dependencies. `@jini-ai/core` is a regular dependency (for the DI token), installed
automatically.

## What you get

**The store port** — `ArtifactStore` (`create` / `get` / `list`) with `CreateArtifactInput`
(`{ name, content, encoding?, artifactManifest? }`) and `ArtifactRecord`, plus
`ArtifactStoreToken` for binding one into a `@jini-ai/core` composition, and
`createInMemoryArtifactStore(options)` as the reference implementation. `create` throws
`ArtifactManifestRequiredError` when no manifest was supplied and the inferrer produced none, and
`ArtifactManifestInvalidError` when the resolved manifest fails taxonomy validation.

**Manifests** — `ArtifactManifest`, `ArtifactStatus`, `ArtifactManifestTaxonomy` /
`emptyArtifactManifestTaxonomy`, with `validateArtifactManifestInput`, `sanitizeManifest`,
`parsePersistedManifest`, `resolveArtifactManifest`, and the `ManifestInferrer` seam
(`noopManifestInferrer` is the default).

**Publication guard** — `assertArtifactPublicationAllowed`, `shouldBlockPublication`,
`findBlockedPlaceholders`, `isPublicationGuardedKind`, `buildArtifactPublicationBlockedMessage`,
`ArtifactPublicationBlockedError`, `ARTIFACT_PUBLICATION_BLOCKED_CODE`, and
`PublicationGuardConfig` / `emptyPublicationGuardConfig`. Both `guardedKinds` and
`blockedPlaceholders` are entirely config — this package ships an empty default rather than opinions
about your content.

**Stub guard** — the pure half: `classifyArtifactStubGuard`, `readArtifactStubGuardConfigFromEnv`,
`slugifyArtifactIdentifier`, `artifactIdentifiersMatch`, `EMPTY_SLUG_FALLBACK_NAME`,
`ArtifactStubGuardMode` (`'reject' | 'warn' | 'off'`), `ArtifactStubGuardConfig` /
`DEFAULT_ARTIFACT_STUB_GUARD_CONFIG`, `PriorArtifactSibling`, `ArtifactStubGuardWarning`,
`EvaluateArtifactStubGuardResult`, `ArtifactRegressionError`.

**Text suppression** — `createTaggedTextSuppressor`, `createXmlTagTextSuppressor(tagNames)`,
`createToolCallTextSuppressor`, and `emitWithTextSuppressor`, with `ArtifactTextSuppressor` /
`ArtifactTextSuppressorStats` / `StreamTextEvent` / `StreamEventSink`.

**Runtime compat** — `RuntimeCompatNormalizer`, `noopRuntimeCompatNormalizer`, and
`composeRuntimeCompatNormalizers`, for adapting an older persisted artifact body forward.

**`./node`** — the disk-touching half of the stub guard: `findPriorArtifactSiblings` and
`evaluateArtifactStubGuard` with `EvaluateArtifactStubGuardInput`.

## Usage

```ts
import {
  createInMemoryArtifactStore,
  createXmlTagTextSuppressor,
  emitWithTextSuppressor,
  assertArtifactPublicationAllowed,
  type ArtifactManifestTaxonomy,
} from '@jini-ai/artifacts';

// The taxonomy is yours; the shipped default accepts nothing on purpose.
const taxonomy: ArtifactManifestTaxonomy = {
  allowedKinds: new Set(['document', 'page']),
  allowedRenderers: new Set(['markdown', 'html']),
  allowedExports: new Set(['md', 'html', 'pdf']),
};

const store = createInMemoryArtifactStore({
  taxonomy,
  inferManifest: (entry) =>
    entry.endsWith('.md') ? { kind: 'document', renderer: 'markdown', exports: ['md'] } : null,
});

const record = await store.create({
  name: 'report.md',
  content: '# Findings\n',
  artifactManifest: {
    kind: 'document',
    renderer: 'markdown',
    exports: ['md'],
    title: 'Findings',
  },
});

// Refuse to publish content still full of placeholders.
assertArtifactPublicationAllowed('document', record.content.toString('utf8'), {
  guardedKinds: new Set(['document']),
  blockedPlaceholders: ['TODO', 'Lorem ipsum'],
});

// Keep artifact markup out of the visible stream while it streams.
const suppressor = createXmlTagTextSuppressor(['artifact']);
emitWithTextSuppressor(suppressor, (ev) => process.stdout.write(ev.delta), 'hello <artifact>');
```

For the disk-backed regression check, import the Node half explicitly:

```ts
import { evaluateArtifactStubGuard } from '@jini-ai/artifacts/node';
```

`PublicationGuardConfig`, `ArtifactManifestTaxonomy`, and `EvaluateArtifactStubGuardInput` are the
types to read for exact field names before wiring real config through.

## Entry points

| subpath | what's behind it | extra dep it pulls in |
|---|---|---|
| `.` | The store port and its in-memory reference, manifests, the publication guard, the pure stub-guard decision logic, text suppression, runtime compat, and `ArtifactStoreToken`. | none |
| `./node` | `findPriorArtifactSiblings` / `evaluateArtifactStubGuard` — the real disk I/O half of the stub guard. Split out so importing the universal logic never forces a resolver to also resolve `node:fs`/`node:path`. | none (Node built-ins) |

## What's swappable

`ArtifactStore` is the port; `createInMemoryArtifactStore` is explicitly a reference implementation
with no durable persistence, so a real adapter (disk, S3, a database) is expected to replace it and
bind through `ArtifactStoreToken`. `ManifestInferrer` decides what an unmanifested artifact becomes.
`ArtifactManifestTaxonomy` and `PublicationGuardConfig` are both caller-supplied and both ship
*empty* — this package validates against your taxonomy rather than asserting one. `ArtifactStubGuardMode`
lets a host pick reject/warn/off. `RuntimeCompatNormalizer` is composable. Fixed: the manifest
validation and sanitization rules themselves, the stub-guard classification logic, and the
suppressor state machines.

## Runtime

`jini.runtime: "universal"` — per-entry, `.` is universal (no Node or browser globals) and `./node`
is Node-only.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and the design decisions behind each
generalization. Apache-2.0, inherited from Open Design — see the repo `NOTICE`.
