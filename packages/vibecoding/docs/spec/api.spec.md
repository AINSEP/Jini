Spec ID: SPEC-JINI-VIBECODING-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:b70fd78d47f5e5e88fbc573b89ee894d24c42ac859487f445de3bb529a37a69c
spec_mode: reverse_spec


# API contract: vibecoding

## Public entry points

| Import | Contract |
|---|---|
| `@jini-ai/vibecoding` (`.`) | Re-exports `/core` |
| `@jini-ai/vibecoding/core` | Universal edit loop, ports and history |
| `@jini-ai/vibecoding/html` | Universal HTML-region target; parser/storage injected |
| `@jini-ai/vibecoding/html/node` | parse5-backed parser |
| `@jini-ai/vibecoding/react` | Sessions, tools, hook and React components; React/ReactDOM optional peers required here |

Signatures describe current source. Factories with optional settings use `(required, optional = {})`; one-object functions and zero-argument methods below currently do not accept a second options object. `createParse5RegionParser()` is a remaining zero-argument factory.

## Root and core

```ts
type PartId = string;
type PartRef = { readonly id: PartId; readonly kind?: string; readonly label?: string };
type Snapshot = { readonly id: string; readonly parts: Readonly<Record<PartId, string>> };
type ProposedEdit = { readonly id: PartId; readonly content: string };
type ValidationResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };
type ApplyOutcome =
  | { readonly status: 'applied'; readonly id: PartId }
  | { readonly status: 'rejected'; readonly id: PartId; readonly reason: string }
  | { readonly status: 'failed'; readonly id: PartId; readonly error: Error };
```

Required `EditTarget` port: `listParts(): Promise<readonly PartRef[]>`, `readPart({ id }): Promise<string>`, `replacePart({ id, content }): Promise<void>`, `snapshot(): Promise<Snapshot>`, `restore({ snapshot }): Promise<void>`, `validate({ id, content }): Promise<ValidationResult>`. Consumers enforce ID authority and evaluate the whole prospective artifact inside `validate`; the package passes an edit, not a preassembled artifact.

| Public call | Return |
|---|---|
| `applyEdit({ target: EditTarget, edit: ProposedEdit })` | `Promise<ApplyOutcome>` |
| `applyEdits({ target: EditTarget, edits: readonly ProposedEdit[] })` | `Promise<readonly ApplyOutcome[]>` |
| `correctionsFor({ outcomes: readonly ApplyOutcome[] })` | `readonly { id: PartId, reason: string }[]` |
| `createEditHistory({ target: EditTarget }, { limit?: number } = {})` | `EditHistory` |

`EditHistory.transaction<T>({ work: (recording: EditTarget) => Promise<T> }, { label?: string } = {}): Promise<T>`; `canUndo()/canRedo(): boolean`; `undo()/redo(): Promise<HistoryEntry | null>`; `restore({ snapshot }): Promise<HistoryEntry | null>`; `entries(): readonly HistoryEntry[]`; `clear(): void`.

Entries carry optional label and ordered `PartChange[]` with id, before, after, existedBefore. No persistent history port is required.

```ts
import { applyEdits, createEditHistory } from '@jini-ai/vibecoding';
const history = createEditHistory({ target }, { limit: 50 });
const outcomes = await history.transaction({
  work: recording => applyEdits({ target: recording, edits }),
}, { label: 'Revise introduction' });
await history.undo();
// Identical calls can import from '@jini-ai/vibecoding/core'.
```

## HTML and Node parser

`AGENT_ELEMENT_ATTRIBUTE = 'data-agent-element'` and `isValidRegionHandle({ handle: string }): boolean` are exported by `/html`; the predicate is also re-exported by `/html/node`.

`createHtmlRegionTarget({ store: HtmlDocumentStore, parser: HtmlRegionParser }, { maxPartLength?: number } = {}): EditTarget`.

`HtmlDocumentStore.read(): Promise<string>`; `write({ html: string }): Promise<void>`. `HtmlRegionParser.findRegions({ html }): readonly ParsedRegion[]`; optional `checkWellFormed({ html }): { ok: true } | { ok: false, reason: string }`. Each `ParsedRegion` contains handle, optional role/label, exact innerStart/innerEnd string offsets; parser must report duplicates and invalid handles in document order.

`createParse5RegionParser(): HtmlRegionParser` has no injected dependencies or options; parse5 is the implementation dependency. It parses a `<div>` fragment context rather than a full document context.

```ts
import { createHtmlRegionTarget } from '@jini-ai/vibecoding/html';
import { createParse5RegionParser } from '@jini-ai/vibecoding/html/node';
let html = '<section data-agent-element="intro">Hello</section>';
const target = createHtmlRegionTarget({
  store: { read: async () => html, write: async ({ html: next }) => { html = next; } },
  parser: createParse5RegionParser(),
});
```

## React session and tools

| Public call | Return |
|---|---|
| `createVibecodingSession({ target }, { historyOptions?: EditHistoryOptions } = {})` | `VibecodingSession` |
| `useVibecodingSession({ session })` | `UseVibecodingSessionResult`; current snapshot, session and bound refresh/read/apply/undo/redo |
| `createVibecodingToolRegistrations({ session }, { policy?: ToolPolicy } = {})` | `ToolRegistration[]` from `@jini-ai/core` |
| `createVibecodingToolRunner({ session })` | `VibecodingToolRunner { descriptors, run({ toolId, input }): Promise<unknown> }` |
| `PartsViewer(props: PartsViewerProps)` | React element; full props in `ui.spec.md` |
| `DocumentPreview(props: DocumentPreviewProps)` | React element; full props in `ui.spec.md` |
| `VibecodingWorkbench(props: VibecodingWorkbenchProps)` | React element; full props in `ui.spec.md` |

Session exposes `target`, `history`, `getSnapshot(): VibecodingSessionSnapshot`, `subscribe({ listener: () => void }): () => void`, `refresh(): Promise<void>`, `readPart({ id }): Promise<string>`, `applyEdits({ edits }, { label? } = {}): Promise<ApplyEditsResult>`, `undo()/redo(): Promise<HistoryEntry | null>`, `takeSnapshot(): Promise<Snapshot>`, `restoreSnapshot({ snapshot }): Promise<HistoryEntry | null>`.

Session snapshots contain status (`idle | loading | ready | error`), parts, readonly part-content map, undo/redo booleans and lastError. `ApplyEditsResult` contains aligned outcomes and corrections.

| `VIBECODING_TOOL_IDS` key / tool ID | Input | Result |
|---|---|---|
| `LIST_PARTS` / `vibecoding.list_parts` | `{}` | `readonly PartRef[]` after refresh |
| `READ_PART` / `vibecoding.read_part` | `{ id: string }` | `{ id, content }` |
| `PROPOSE_EDITS` / `vibecoding.propose_edits` | `{ edits: ProposedEdit[], label?: string }` | `ApplyEditsResult` |
| `UNDO` / `vibecoding.undo` | `{}` | `{ entry: HistoryEntry \| null }` |
| `REDO` / `vibecoding.redo` | `{}` | `{ entry: HistoryEntry \| null }` |

```tsx
import { createVibecodingSession, createVibecodingToolRunner,
  VibecodingWorkbench } from '@jini-ai/vibecoding/react';
const session = createVibecodingSession({ target });
const runner = createVibecodingToolRunner({ session });
await runner.run({ toolId: 'vibecoding.propose_edits', input: { edits } });
const pane = <VibecodingWorkbench session={session} documentHtml={html} />;
```

Consumers own chat transport/model calls, persistence, authorization policy and execution environments. Evidence: all five source barrels and their implementation/test modules; tests were not run.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `CreateVibecodingToolRegistrationsOptions`, `VibecodingToolArgs` | type; [tools.ts](../../src/react/tools.ts) |
| `HtmlRegionTargetDeps`, `HtmlRegionTargetOptions` | type; [regions.ts](../../src/html/regions.ts) |
| `UseVibecodingSessionArgs` | type; [use-vibecoding-session.ts](../../src/react/use-vibecoding-session.ts) |
| `VibecodingSessionArgs`, `VibecodingSessionOptions` | type; [session.ts](../../src/react/session.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./core`, `./html`, `./html/node`, `./react`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
