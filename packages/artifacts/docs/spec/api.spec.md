Spec ID: SPEC-JINI-ARTIFACTS-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:1920e3204f113d78177c5b6b22a4c7de819581047d08a69b2abc813386f07207
spec_mode: reverse_spec


# API contract: artifacts

## Entry points and signatures

Exports: `@jini-ai/artifacts` (`.`) and `@jini-ai/artifacts/node` (`./node`). The root is universal; publication guards decode byte content using standard TextDecoder without Node built-ins. All calls below use a required object; only shown optional objects exist in source. Some methods still take zero arguments.

| Root export | Return / dependencies |
|---|---|
| `validateArtifactManifestInput({ manifest: unknown, entry: unknown, taxonomy }, optional: ValidateManifestOptions = {})` | `{ ok: true, value: ArtifactManifest \| null } \| { ok: false, error: string }` |
| `sanitizeManifest({ manifest: Record<string, unknown>, entry: string }, optional: ValidateManifestOptions = {})` | `ArtifactManifest`; requires already validated fields |
| `parsePersistedManifest({ raw, fallbackEntry, taxonomy })` | `ArtifactManifest \| null` |
| `noopManifestInferrer({ entry })` | `null` |
| `resolveArtifactManifest({ input: CreateArtifactInput, taxonomy, inferManifest }, optional: ValidateManifestOptions = {})` | `ArtifactManifest` or typed error |
| `createInMemoryArtifactStore({}, options: InMemoryArtifactStoreOptions = {})` | `ArtifactStore`; optional `taxonomy`, `inferManifest`, `now: () => string`, `contentCodec` |
| `new ArtifactManifestRequiredError({ name })`; `new ArtifactManifestInvalidError({ message })` | `Error` with stable `code` |

`ArtifactManifestTaxonomy` supplies `allowedKinds`, `allowedRenderers`, `allowedExports` as read-only sets; `emptyArtifactManifestTaxonomy` accepts none. `ValidateManifestOptions` has `preserveUpdatedAt`, `now`. `ManifestInferrer({ entry }): Partial<ArtifactManifest> | null` is caller-supplied.

`ArtifactManifest` carries version, kind, title, entry, renderer, status (`streaming | complete | error`), exports, created/updated strings; optional primary (`string | true`), supporting files, source context ID and metadata. `CreateArtifactInput` requires `name`, string `content`; optional encoding (`utf8 | base64`) and unknown manifest.

`ArtifactStore.create(input: CreateArtifactInput): Promise<ArtifactRecord>`; `get({ name }): Promise<ArtifactRecord | null>`; `list(): Promise<ArtifactRecord[]>`. Records contain name, `Uint8Array` content and manifest. `ArtifactContentCodecPort.decode({ content }, { encoding? }): Uint8Array` supplies decoding. `ArtifactStoreToken` is the typed DI token `jini.artifactStore` and binds nothing automatically.

| Guard / normalization export | Return |
|---|---|
| `isPublicationGuardedKind({ kind: unknown, config })` | `boolean` |
| `findBlockedPlaceholders({ value: unknown, config })` | `string[]` |
| `shouldBlockPublication({ value: unknown, config })` | `boolean`; does not check kind |
| `buildArtifactPublicationBlockedMessage({ placeholders })` | `string` |
| `assertArtifactPublicationAllowed({ kind, value, config })` | `void` or `ArtifactPublicationBlockedError` |
| `new ArtifactPublicationBlockedError({ placeholders })` | `Error`, copied placeholder list and `ARTIFACT_PUBLICATION_BLOCKED_CODE` |
| `noopRuntimeCompatNormalizer({ name, body })` | Original `body: unknown` |
| `composeRuntimeCompatNormalizers({ normalizers })` | `RuntimeCompatNormalizer({ name: string, body: unknown }): unknown` |
| `slugifyArtifactIdentifier({ value: string })` | `string` |
| `artifactIdentifiersMatch({ a: string, b: string })` | `boolean` |
| `readArtifactStubGuardConfigFromEnv({ env, names: { mode, minRatio, minPriorBytes } }, { defaults? } = {})` | `ArtifactStubGuardConfig` |
| `classifyArtifactStubGuard({ priors, identifier, newSize, config })` | `{ outcome: 'pass' \| 'warn' \| 'reject', warning?: ArtifactStubGuardWarning }` |
| `new ArtifactRegressionError({ message, details: { identifier, newSize, priorSize, priorName } })` | `Error` with regression details; classifiers do not throw it |

`PublicationGuardConfig` contains `guardedKinds` and ordered `blockedPlaceholders`; `emptyPublicationGuardConfig` blocks nothing. Stub config contains mode, ratio, minimum prior bytes and sibling extensions. Public `DEFAULT_ARTIFACT_STUB_GUARD_CONFIG` is warn/0.2/4096/`.html,.htm`; `EMPTY_SLUG_FALLBACK_NAME = 'artifact'`.

| Streaming export | Return / consumer dependency |
|---|---|
| `createTaggedTextSuppressor({ openRe, closeRe, isPossibleOpen, isPossibleClose })` | `ArtifactTextSuppressor`; predicates accept `{ text: string }` |
| `createXmlTagTextSuppressor({ tagNames: readonly string[] })` | `ArtifactTextSuppressor` |
| `createToolCallTextSuppressor({})` | `ArtifactTextSuppressor` |
| `emitWithTextSuppressor({ suppressor, onEvent, text })` | `boolean`; sink `(event: { type: 'text_delta', delta: string }): void` |

Suppressor methods: `strip({ text }): string`, `flush(): string`, `isSuppressing(): boolean`, `hasPendingCandidate(): boolean`, `stats(): ArtifactTextSuppressorStats` (suppressed chars/chunks, opened/closed blocks, pending chars, suppressing). See behavior limitations before use.

## Node subpath

`findPriorArtifactSiblings({ scanDir, identifier, config: Pick<ArtifactStubGuardConfig, 'siblingExtensions'> }, { filesystem? } = {}): Promise<PriorArtifactSibling[]>`.

`evaluateArtifactStubGuard({ scanDir, identifier, newSize, config }, { filesystem? } = {}): Promise<EvaluateArtifactStubGuardResult>`.

`ArtifactStubFilesystemPort`: `readFile({ path }): Promise<string>`, `readdir({ path }): Promise<Dirent[]>`, `stat({ path }): Promise<{ size: number }>`; native Node filesystem is the default. Prior siblings contain name and numeric size.

## Minimal wiring

```ts
import { createInMemoryArtifactStore, assertArtifactPublicationAllowed } from '@jini-ai/artifacts';
const taxonomy = {
  allowedKinds: new Set(['document']), allowedRenderers: new Set(['html']),
  allowedExports: new Set(['html']),
};
const store = createInMemoryArtifactStore({}, { taxonomy });
assertArtifactPublicationAllowed({ kind: 'document', value: html, config: publicationConfig });
await store.create({ name: 'report.html', content: html,
  artifactManifest: { kind: 'document', renderer: 'html', exports: ['html'] } });
```

```ts
import { evaluateArtifactStubGuard } from '@jini-ai/artifacts/node';
const decision = await evaluateArtifactStubGuard({ scanDir, identifier, newSize, config });
if (decision.outcome === 'reject') throw new Error(decision.warning?.message);
```

Consumers own policy, persistent adapters and applying returned guard decisions. Evidence: exported source barrels, implementation modules and source tests; tests were read, not executed.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `ArtifactStatus` | type; [manifest.ts](../../src/manifest.ts) |
| `ArtifactStubGuardMode` | type; [stub-guard.ts](../../src/stub-guard.ts) |
| `EvaluateArtifactStubGuardInput` | interface; [stub-guard.ts](../../src/node/stub-guard.ts) |
| `StreamEventSink`, `StreamTextEvent` | type; [text-suppression.ts](../../src/text-suppression.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./node`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
