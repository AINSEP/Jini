Spec ID: SPEC-JINI-MEMORY-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:970f786aa324f6b1bd31d69f5e5ed8c583b9bc2a7216e6db451ab3d7741b7176
spec_mode: reverse_spec


# API contract: memory

## Entry point and calling convention

`@jini-ai/memory` (`.`) is the only package export; it is Node-only. Signatures below reflect current source. A shown second object defaults to `{}`; a signature with one object or no arguments currently has no second parameter. Do not add speculative shared base types.

## Notes and text helpers

| Public call | Return / consumer dependency |
|---|---|
| `createNoteStore({ validTypes: readonly string[], defaultType: string }, optional = {})` | `NoteStore`; optional `subdir`, native-protocol `filesystem`, `now: () => number`, `ids: () => string` |
| `parseEntryFrontmatter({ raw: string })` | `{ data: EntryFrontmatter, body: string }`; fields are `name`, `description`, `type` strings |
| `renderEntryFrontmatter({ fields: EntryFrontmatter, body: string })` | `string` |
| `parseRuleBody({ body: string })` | `ParsedRuleBody { assertion, check, rationale }` |
| `hasInvalidSubdirLength({ subdir: unknown })` | `boolean` |
| `isReservedRelativeSegment({ subdir: string })` | `boolean` |
| `containsPathSeparatorOrNul({ subdir: string })` | `boolean` |
| `isMultiSegmentOrAbsoluteWin32Path({ subdir: string })` | `boolean` |
| `isValidUpsertInput({ name, type, isType })` | `boolean`; strings plus `isType({ type: unknown }): boolean` |
| `resolveUpsertEntryId({ id?, type, name, isId, deriveId })` | `string`; `isId({ id }): boolean`, `deriveId({ type, name }): string` |
| `buildUpsertChangeEvent({ entry: NoteEntrySummary }, { source?: string } = {})` | `Omit<NoteChangeEvent, 'at'>` |
| `new NoteStoreConfigError({ message: string, code: string }, { cause?: unknown } = {})` | `Error` with `code` and optional cause |

`NoteStoreFilesystemPort` is a native Node protocol port: `mkdir`, `realpath`, `lstat`, `readFile`, `readdir`, `open`, `rename`, `unlink` retain Node signatures. It is not an object-argument wrapper. Native `fs.promises` is the default.

The returned store exposes `events: EventEmitter` and these methods:

| Call | Return |
|---|---|
| `dir({ dataDir })`; `deriveId({ type, name })` | `string` |
| `readConfig({ dataDir })`; `writeConfig({ dataDir, patch: Partial<NoteStoreOptions> })` | `Promise<{ enabled: boolean }>` |
| `readIndex({ dataDir })` | `Promise<string>` |
| `writeIndex({ dataDir, body }, { silent?: boolean })` | `Promise<void>` |
| `listEntries({ dataDir })`; `listActiveEntries({ dataDir })` | `Promise<NoteEntrySummary[]>` |
| `readEntry({ dataDir, id })` | `Promise<NoteEntry \\| null>` |
| `upsertEntry({ dataDir, input: NoteUpsertInput }, { silent?: boolean, source?: string })` | `Promise<NoteEntry>` |
| `deleteEntry({ dataDir, id })` | `Promise<void>` |
| `updateTreeNode({ dataDir, id, patch: NoteTreePatch })` | `Promise<NoteEntry>` |
| `buildTree({ dataDir })` | `Promise<NoteTreeNode[]>` |

All unannotated fields above are strings. `NoteUpsertInput` requires `name`, `type`, accepts `id`, `description`, `body`; `NoteTreePatch` accepts `name`, `description`, `type`, `body`. Summaries carry `id`, `name`, `description`, `type`, numeric `updatedAt`; entries add `body`. Tree nodes add `parentId`, `path`, `kind: 'folder' | 'entry'`, ISO-string times and `childrenCount`.

## Extraction and verification

| Public call | Return / consumer dependency |
|---|---|
| `createExtractionLog({}, { now?, ids?, defer? } = {})` | `ExtractionLog`; `now/ids` are zero-argument functions, `defer({ callback }): void` |
| `createVerifyLog({}, { now?, ids?, defer? } = {})` | `VerifyLog`; same optional ports |
| `enforceVerify(input: EnforceVerifyInput)` | `VerifyResult`; supply `assistantOutput`, `activeRules: { name, check? }[]`, `hadArtifact`, `verifyEnabled`, `extractScorecard({ output }): VerifyScorecard \| null` |
| `extractFacts({ llmConfig: LlmProviderConfig, content: string }, options: ExtractFactsOptions = {})` | `Promise<{ facts: ExtractedFact[], raw: string }>`; optional `sourceLabel`, `llm`, `prompt`, `logging: { log, kind }` |
| `factToNoteDraft({ fact: ExtractedFact, type: string })` | `NoteDraft { name, description, type }`; no store write |

`ExtractedFact` requires `statement`; optional `category`, `entities`, `confidence`, `sourceQuote`. Prompt options: `systemPrompt`, `suggestedCategories`, `maxFacts`. Public defaults: `DEFAULT_MAX_FACTS = 20` and `DEFAULT_SYSTEM_PROMPT` (generic JSON fact-extraction instructions).

`ExtractionLog` exposes `events`, `startExtraction({ userMessage, kind }): string`, `recordSkip({ userMessage, reason, kind }): string`, `recordHeuristic({ userMessage, kind, writtenCount, writtenIds }): string`, `markProvider({ id, provider }): void`, `markProposed({ id, proposedCount }): void`, `markSuccess({ id, outcome: { writtenCount, writtenIds } }): void`, `markFailed({ id, error }): void`, `list(): ExtractionRecord[]`, `remove({ id }): number`, `clear(): number`.

`VerifyLog` exposes `events`, `record({ result: VerifyResult }, { runId?, contextId? } = {}): VerifyRecord | null`, `list(): VerifyRecord[]`, `remove({ id }): number`, `clear(): number`. `VerifyResult` carries status, optional skip reason, active/covered/total/failed counts, uncovered names, artifact flag and optional scorecard status. Rows are `{ rule: string, status: 'pass' | 'fail' }`.

## LLM HTTP primitive

| Public call | Return |
|---|---|
| `callLlmProvider({ config, systemPrompt, userPrompt }, optional: LlmProviderOptions = {})` | `Promise<string>` |
| `callLlmProviderForJson<T = unknown>({ config, systemPrompt, userPrompt }, optional: LlmProviderOptions = {})` | `Promise<T>`; caller validates shape |
| `parseStrictJson<T = unknown>({ rawText: string })` | `T`; unchecked generic |
| `appendVersionedApiPath({ baseUrl: string, suffix: string })` | `string` |
| `describeFetchError({ err: unknown })` | `string` |

Required `LlmProviderConfig`: `provider: 'anthropic' | 'openai' | 'azure' | 'google'`, `apiKey`, `model`. Optional ports/settings: `fetchFn: typeof fetch`, `timeoutSignal({ timeoutMs }): AbortSignal`, `baseUrl`, `apiVersion`, `extraHeaders`, `requestInit`, `timeoutMs`. Azure requires an explicit resource URL. Public defaults: `DEFAULT_TIMEOUT_MS = 30000`, `AZURE_DEFAULT_API_VERSION = '2024-10-21'`.

## Minimal wiring

```ts
import { createNoteStore, extractFacts, factToNoteDraft } from '@jini-ai/memory';
const notes = createNoteStore({ validTypes: ['fact'], defaultType: 'fact' });
const { facts } = await extractFacts({ llmConfig, content }, { llm: { fetchFn } });
for (const fact of facts) {
  await notes.upsertEntry({ dataDir, input: factToNoteDraft({ fact, type: 'fact' }) });
}
```

The consumer supplies credentials, content, data root, retention/consent policy and any custom transport. Evidence: `src/index.ts`, the exported source modules and `src/__tests__/integration-ports.test.ts`; tests were read, not executed.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `ActiveRuleForVerify`, `VerifyScorecardRow`, `VerifyScorecardRowStatus`, `VerifyStatus` | type; [verify.ts](../../src/verify.ts) |
| `ExtractFactsInput`, `ExtractFactsLogOptions`, `ExtractFactsPromptConfig`, `ExtractFactsResult` | type; [extract-facts.ts](../../src/extract-facts.ts) |
| `ExtractionPhase`, `ExtractionProvider` | type; [extraction-log.ts](../../src/extraction-log.ts) |
| `LlmProviderId` | type; [llm-provider.ts](../../src/llm-provider.ts) |
| `NoteChangeKind`, `NoteStoreConfig`, `NoteStoreOptionalArgs` | type; [note-store.ts](../../src/note-store.ts) |

## Current manifest boundary

The current `package.json` exposes `.`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
