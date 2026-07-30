# `@jini-ai/memory`

A durable notes/memory capability for a daemon: Markdown files with YAML frontmatter on disk, a
hand-editable `INDEX.md` that decides which notes are *active*, a bounded log of extraction attempts,
a self-verify scorecard, and a small multi-vendor "call an LLM HTTP API and get strict JSON back"
primitive. The design choice worth knowing up front: the index file is the source of truth for what
counts as active, so a user removing a bullet disables that note from prompt composition while
leaving the file itself on disk. Nothing here is a vector store or an embedding pipeline.

## Install

```sh
npm install @jini-ai/memory
```

No dependencies at all — not even another `@jini-ai/*` package. No peer dependencies. Everything it
uses is a Node built-in plus `fetch`.

## What you get

**The note store** — `createNoteStore(config)` returns a `NoteStore` whose every method takes the
`dataDir` to operate in, so one store instance serves many workspaces: `listEntries`,
`listActiveEntries`, `readEntry`, `upsertEntry`, `deleteEntry`, `updateTreeNode`, `buildTree`,
`readIndex`/`writeIndex`, `readConfig`/`writeConfig`, `dir`, `deriveId`, and an `events` emitter
carrying `NoteChangeEvent`. Types: `NoteEntry`, `NoteEntrySummary`, `NoteTreeNode`, `NoteStoreConfig`,
`NoteStoreOptions`, `NoteChangeKind`. `NoteStoreConfigError` is thrown when on-disk config cannot be
*trusted* (corrupt JSON, permission denied, a directory escaping its data root) — deliberately
distinct from "genuinely missing", so a permission failure can never silently re-enable memory.

**Frontmatter and rule bodies** — `parseEntryFrontmatter` / `renderEntryFrontmatter` with
`EntryFrontmatter`, and `parseRuleBody` / `ParsedRuleBody` for the labeled-line body format.

**Extraction log** — `createExtractionLog` returning an `ExtractionLog`, with `ExtractionRecord`,
`ExtractionPhase`, `ExtractionProvider`. Bounded by construction, so a long-running daemon cannot
grow it without limit.

**Self-verify** — `enforceVerify(input)` (a pure scorecard enforcer) and `createVerifyLog`, with
`EnforceVerifyInput`, `ActiveRuleForVerify`, `VerifyResult`, `VerifyStatus`, `VerifyScorecard`,
`VerifyScorecardRow`, `VerifyScorecardRowStatus`, `VerifyRecord`, `VerifyLog`.

**Strict-JSON LLM calls** — `callLlmProvider` and `callLlmProviderForJson` over an
`LlmProviderConfig` / `LlmProviderId`, plus `parseStrictJson`, `describeFetchError`,
`appendVersionedApiPath`, `AZURE_DEFAULT_API_VERSION`, `DEFAULT_TIMEOUT_MS`.

**Fact extraction** — `extractFacts(input, options)` → `ExtractFactsResult` and
`factToNoteDraft(fact)` → `NoteDraft`, with `DEFAULT_MAX_FACTS`, `DEFAULT_SYSTEM_PROMPT`,
`ExtractedFact`, `ExtractFactsPromptConfig`, `ExtractFactsLogOptions`.

## Usage

```ts
import { createNoteStore, enforceVerify, extractFacts, factToNoteDraft } from '@jini-ai/memory';

const store = createNoteStore({
  validTypes: ['preference', 'fact', 'decision'],
  defaultType: 'fact',
  subdir: 'notes',
});

const dataDir = '/var/lib/example/workspace-1';

const entry = await store.upsertEntry(dataDir, {
  name: 'Prefers pnpm',
  description: 'Use pnpm, never npm, in this repo.',
  type: 'preference',
  body: 'The lockfile is pnpm-lock.yaml; npm install rewrites it.',
});

// INDEX.md decides which notes are active — file presence alone does not.
const active = await store.listActiveEntries(dataDir);
const tree = await store.buildTree(dataDir);

store.events.on('change', (e) => console.log(e.kind, e.id));

// Pull candidate notes out of a transcript, then persist the ones you want.
const result = await extractFacts(
  { provider: 'openai', apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-4o-mini' },
  { content: 'We decided to freeze merges after Thursday.', sourceLabel: 'standup 2026-07-29' },
  { prompt: { suggestedCategories: ['decision', 'preference'], maxFacts: 5 } },
);
for (const fact of result.facts) {
  await store.upsertEntry(dataDir, factToNoteDraft(fact, 'decision'));
}
```

Note that `factToNoteDraft` takes the note `type` explicitly: a fact's model-assigned `category` is
never auto-mapped onto your `validTypes`, because that taxonomy is yours and the model does not know
it.

## What's swappable

`NoteStoreConfig` is the taxonomy seam: `validTypes` / `defaultType` / `subdir` are entirely the
host's, which is why nothing here carries a product's own note categories. The LLM layer is
provider-agnostic through `LlmProviderConfig`, and `extractFacts` accepts an
`ExtractFactsPromptConfig` so the system prompt is not baked in. The `dataDir`-per-call shape means
storage location is the caller's decision on every operation. Fixed and not injectable: the on-disk
format (frontmatter Markdown + `INDEX.md` + `.config.json`), the index-is-truth activation rule, the
id derivation, and the `node:fs` I/O itself — there is no filesystem port.

## Runtime

`jini.runtime: "node"` — `node:fs`, `node:path`, and `node:events`; the LLM primitive uses global
`fetch`.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and which behavior was generalized
versus deliberately left in the originating product. Apache-2.0, inherited from Open Design — see the
repo `NOTICE`.
