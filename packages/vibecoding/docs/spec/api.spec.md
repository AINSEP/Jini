Spec ID: SPEC-JINI-VIBECODING-API
Version: 2.1.0
Last Edited: 2026-10-24
Hash: sha256:e4fa5c947ad8e8c3e6a090a3e4b64a135411ab9efff81547f84473ce2076febd
spec_mode: reverse_spec


# API contract: vibecoding

## Public entry points

| Import | Contract |
|---|---|
| `@jini-ai/vibecoding` (`.`) | Re-exports `/core` |
| `@jini-ai/vibecoding/core` | Universal edit loop, ports and history |
| `@jini-ai/vibecoding/html` | Universal HTML-region target and pure scan-based edits; parser/storage injected |
| `@jini-ai/vibecoding/html/node` | parse5-backed strict parser and non-throwing region scan |
| `@jini-ai/vibecoding/session` | Universal session and tools; no React dependency |
| `@jini-ai/vibecoding/node` | Local file-tree projects; Node filesystem runtime |
| `@jini-ai/vibecoding/react` | Session/tool re-exports, hook and React components; React/ReactDOM optional peers required here |

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

`EditHistory.transaction<T>({ work: (recording: EditTarget) => Promise<T> }, { label?: string } = {}): Promise<T>`; `canUndo()/canRedo(): boolean`; `undo()/redo(): Promise<HistoryEntry | null>`; `restore({ snapshot }): Promise<HistoryEntry | null>`; `entries(): readonly HistoryEntry[]`; `retainedEntries(): readonly HistoryEntry[]` (both stacks); `clear(): void`.

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

## HTML region scan + pure edits

`scanHtmlRegions({ html: string }, options: Record<string, never> = {}): HtmlRegionScan`
is exported by `/html/node`. It parses once in a `<div>` fragment context and returns diagnostics
instead of throwing for malformed HTML. `/html` exports the pure helpers below without a parser
dependency. Every scan belongs to exactly one unchanged source string; scan each new string once
and share that result across helpers. Offsets index the original JavaScript string in UTF-16 code
units, preserving CRLF, BOM and astral-character slices; no parse/serialize rewrite occurs.

```ts
interface ScannedRegion extends ParsedRegion {
  readonly tag: string;
  readonly start: number;
  readonly end: number;
  readonly problem?: string;
}
interface HtmlTopLevelElement {
  readonly tag: string;
  readonly handle?: string;
  readonly start: number;
  readonly end: number;
  readonly innerStart: number;
  readonly innerEnd: number;
}
interface HtmlRegionScan {
  readonly regions: readonly ScannedRegion[];
  readonly topLevel: readonly HtmlTopLevelElement[];
  readonly documentProblem?: string;
  readonly parseErrorReasons?: readonly string[];
}
type RegionLookupProblem =
  | { readonly kind: 'absent'; readonly available: readonly string[] }
  | { readonly kind: 'ambiguous'; readonly count: number }
  | { readonly kind: 'not-replaceable'; readonly tag: string };
type RegionLookup = { readonly region: ScannedRegion } | { readonly problem: RegionLookupProblem };
type RegionMoveProblem = 'self' | 'into-itself';
interface RegionHandleOptions { readonly slugify: (text: string) => string }
interface UntaggedSection { readonly tag: string; readonly suggestedHandle: string | undefined }
```

All these types are exported by `/html`; `/html/node` also re-exports `HtmlRegionScan`,
`HtmlTopLevelElement` and `ScannedRegion`. `ParsedRegion` retains its existing inner-offset contract;
`ScannedRegion` adds required tag/outer offsets and an optional problem. `start`/`end` delimit the
whole element and `innerStart`/`innerEnd` its body, with exclusive end offsets. Missing start-tag
locations yield `-1` for all four offsets. Recovered end offsets may support tagging advice but are
unsafe for editing when `problem` is present. Regions and direct fragment-child elements are sorted
by source offset, including when parse5 foster-parenting reorders the tree. No depth is exposed.

| Pure call exported by `/html` | Return and contract |
|---|---|
| `locateRegion({ scan: HtmlRegionScan, handle: string }, options = {})` | `RegionLookup`; absent with all available handles, ambiguous with count, or not-replaceable with tag; otherwise one safe region |
| `replaceRegionInner({ html: string, region: ParsedRegion, fragment: string }, options = {})` | `string`; splice only the inner range; caller must supply safe offsets for this exact string |
| `moveRegion({ html: string, moving: ScannedRegion, target: ScannedRegion, placement: 'before' \| 'after' }, options = {})` | `{ readonly html: string } \| { readonly problem: RegionMoveProblem }`; move a whole element with adjoining whitespace; refuse itself or a destination inside itself |
| `handlesMadeAmbiguous({ before: HtmlRegionScan, after: HtmlRegionScan }, options = {})` | `string[]`; each handle whose after-count is greater than one and greater than its before-count, once in after source order |
| `regionHandlesIn({ scan: HtmlRegionScan }, options = {})` | `string[]`; source order, retaining duplicates, unsafe regions, empty values and legacy grammar |
| `suggestRegionHandle({ inner: string, taken: ReadonlySet<string> }, { slugify }: RegionHandleOptions)` | `string \| undefined`; first heading's inner text with inline tags replaced by spaces, host slugifier, truncate to 48 code units and strip trailing hyphens; absent/empty/colliding suggestions are undefined |
| `untaggedTopLevelSections({ html: string, scan: HtmlRegionScan }, options: RegionHandleOptions)` | `readonly UntaggedSection[]`; untagged direct content elements with heading suggestions reserved within the batch; skip style, script, template, link, meta, base and title |

The five calls with `options = {}` accept `Record<string, never>`. The two suggestion calls require
the host's slugifier; no default slugification dependency is supplied. Move carries trailing
whitespace, falling back to leading whitespace when there is no trailing run, and may return the
same HTML for an adjacent move. Neither splice helper reparses, checks stale offsets, enforces
handle policy nor writes storage; resolve safe regions first and retain the host's version basis
through commit.

`scanHtmlRegions` retains discovered invalid/duplicate handles and marks unsafe boundaries per
region. A dropped source handle becomes `documentProblem`; parser errors become `parseErrorReasons`
(the current scanner always supplies that array). Neither diagnostic globally blocks lookup of a
safe region. Comment and literal-text body mentions are excluded from the dropped-handle check,
including `noscript` with scripting enabled; attributes on the text-bearing element still count.
parse5 formatting clones sharing an authored start offset collapse to one unsafe address.
HTML5 recovery recognizes unquoted values and upper-case attribute names. A non-void self-closing
slash leaves the element open; `<section data-agent-element="hero"/>body</section>` is editable
because its explicit close supplies safe boundaries. Unclosed top-level elements use recovered
boundaries for advice, while malformed opening tags/declarations follow parse5 recovery.

`createParse5RegionParser()` delegates both methods to the scan. `findRegions` throws for the first
region problem, then for a document problem; parse errors alone do not make it throw.
`checkWellFormed`, always present on the factory's return type, rejects those location problems
before rejecting any parse-error reasons. These strict adapter methods remain available to
`createHtmlRegionTarget`; the pure path permits adding/removing handles and leaves persistence,
authorization, version checks and write policy to the host. See [behavior](behavior.spec.md#html-region-scan--pure-edits)
for the intentional HTML5 recovery differences and consumer policy boundary.

## React session and tools

| Public call | Return |
|---|---|
| `createVibecodingSession({ target }, { historyOptions?: EditHistoryOptions, history?: EditHistory, applyTurn? } = {})` | `VibecodingSession` |
| `useVibecodingSession({ session })` | `UseVibecodingSessionResult`; current snapshot, session and bound refresh/read/apply/undo/redo |
| `createVibecodingToolRegistrations({ session }, { policy?: ToolPolicy } = {})` | `ToolRegistration[]` from `@jini-ai/core` |
| `createVibecodingToolRunner({ session })` | `VibecodingToolRunner { descriptors, run({ toolId, input }): Promise<unknown> }` |
| `PartsViewer(props: PartsViewerProps)` | React element; full props in `ui.spec.md` |
| `DocumentPreview(props: DocumentPreviewProps)` | React element; full props in `ui.spec.md` |
| `VibecodingWorkbench(props: VibecodingWorkbenchProps)` | React element; full props in `ui.spec.md` |

Sessions and tools are defined in `./session`; `./react` re-exports the identical implementations. Inject `history: project.history` and `applyTurn: project.applyEdits` together for file-tree sessions. The injected callback takes `({ edits }, { label? } = {})` and returns aligned `ApplyOutcome[]`; it owns transaction recording. The default session retains sequential per-file semantics.

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

Consumers own chat transport/model calls, authorization policy and execution environments; Node projects own local revision persistence in host-selected storage. Evidence: all five source barrels and their implementation/test modules; tests were not run.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `CreateVibecodingToolRegistrationsOptions`, `VibecodingToolArgs` | type; [tools.ts](../../src/tools.ts) |
| `HtmlRegionTargetDeps`, `HtmlRegionTargetOptions` | type; [regions.ts](../../src/html/regions.ts) |
| `UseVibecodingSessionArgs` | type; [use-vibecoding-session.ts](../../src/react/use-vibecoding-session.ts) |
| `VibecodingSessionArgs`, `VibecodingSessionOptions` | type; [session.ts](../../src/session.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./core`, `./html`, `./html/node`, `./session`, `./node`, `./react`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.


## Node projects

`openFileTreeProject({ root, stateDir, policy, validator? }, { limits?, historyLimit? } = {})`
returns `Promise<FileTreeProject>`. `root` is the real app working tree, watched by the dev server.
`stateDir` is a private host-owned directory physically outside that tree; neither directory may
contain the other. It holds `objects/<sha256>`, `manifests/<sha256>.json`, `current.json` and the
shared file lock. The host supplies `policy.allows({ relativePath }): boolean`; mandatory exclusions
always take precedence. First open captures allowed existing files, including binary assets.

`PartId` is the canonical relative path. Changes are `{op:'create', relativePath, content}`,
`{op:'replace', id, content}` or `{op:'delete', id}`. Create has no reservation lifecycle.
`RevisionToken` contains `{revisionId, generation}`. `ProjectSnapshot` contains `{revisionId}`.

| Call | Contract |
|---|---|
| `getRevision()` | Current persisted token; does not itself capture disk drift |
| `capture()` | Capture external edits as an undoable revision; never rewrite the working tree |
| `applyTurn({ expectedRevision, changes }, { label?, signal? } = {})` | One complete candidate; returns `{status: 'committed' \| 'unchanged' \| 'rejected', revision, diagnostics}` |
| `history.undo()` / `redo()` | Select complete revisions, including exact creates/deletes, after capturing drift |
| `history.entries()` / `retainedEntries()` | Private pointer changes; the latter includes undo and redo pins |
| `snapshot()` / `restore({snapshot}, {label?} = {})` | Retained-manifest snapshot; restore is undoable, an expired snapshot throws |
| `target` | Existing-file UTF-8 `EditTarget`; direct replacements use the same whole-turn service |
| `applyEdits({edits}, {label?} = {})` | Session adapter for replacements; aligned outcomes, no extra history transaction |
| `close()` | Clear local history and collect unreferenced revisions/objects; later operations throw `CLOSED` |

`validator.validate({candidate, signal}, {})` is optional, defaulting to approval. The immutable
candidate lists all managed `paths` and offers `readBytes({relativePath}, {})` returning a copy.
The validator runs once outside the shared lock. Refusal returns bounded diagnostics (100 entries,
100-character codes, 2000-character messages); exception/timeout/cancellation throws. Generation
and working-tree drift are checked again under the lock before selection. No compiler is supplied.

Defaults: 2000 files, 2 MiB/file, 64 MiB/tree, depth 32, 100 changes/turn, 30 seconds validation,
and 50 history entries. Options must be positive safe integers. Overflow refuses without truncation.
Portable names have a 200-code-unit relative-path cap; Windows devices (including extensions),
controls, reserved punctuation, trailing dots/spaces, traversal, drive/UNC and backslash spellings
are refused. Case/NFC collisions include directory prefixes and are checked on the final candidate,
so a delete/create case-only rename is valid. Unicode filename spelling is preserved; NFC is used for collision comparison. Platform's guarded reader owns containment, deny folding and
bounded listing/reads. Links/junctions and special files cannot be materialization targets.

Exclusions: `node_modules`, `.git`, `.env*` (including directory segments), `dist`, `build`, `out`,
`coverage`, `.next`, `.nuxt`, `.angular`, `.vite`, `.cache`, `.turbo`. Host-disallowed files remain
unmanaged. Refusing a candidate never publishes its changes. Existing external drift is independently
captured even when a turn is later refused. Same-content timestamp drift only refreshes fingerprints.

Revisions are content-addressed blobs plus immutable manifests, not copied trees. Commit persists
objects/manifest, atomically selects `{revision,generation,pending}`, deletes removed managed files,
writes the selected files, prunes empty managed folders, then atomically clears `pending`. Empty
managed directory aliases or blockers are pruned before writes when needed for a case rename or a
file/directory transition. Unmanaged directory contents prevent such transitions before selection.
On reopen, pending materialization rolls forward idempotently. File updates are observable during
materialization; the journal guarantees process-crash recovery, not simultaneous multi-file visibility
or power-loss durability on every filesystem. An I/O failure after journal publication can leave a
committed pending revision; the next locked operation/reopen recovers it. Never replace corrupt
state with an empty project. The root is host-controlled: this is not a hostile-process sandbox.

Before a turn or replay, compare managed disk files by size, mtime and ctime; unchanged fingerprints
reuse object bytes, changed fingerprints trigger bounded reads and hashing. `capture()` records npm,
editor and user changes normally. Every selection (including undo/redo) increments generation;
another writer's generation clears both local history stacks and throws `CONFLICT`; a stale caller
token alone throws `CONFLICT` and keeps history. The same handle may retry after
refresh/capture; reopening is not required. The private pointer write is the only and last write in
a history transaction. Public `history.transaction` is refused; use `applyTurn`. `target.snapshot()`
requires UTF-8 files and returns a retained-manifest ID; its restore uses that ID, not an arbitrary
parts map. Binary-safe snapshots use `project.snapshot()`.

Garbage collection pins current plus both local history stacks. Snapshots do not independently pin
storage and can expire. History is session-local, not persisted; another writer's generation
invalidates it. No Git history, process execution, package install, preview, UI or deployment API is
included. See [DR-002](../decisions/DR-002-file-tree-revisions.md).
