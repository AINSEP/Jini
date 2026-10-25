# @jini-ai/vibecoding

Conversational artifact authoring — the loop that turns "make the hero blue" into a validated,
undoable change, without knowing what kind of artifact it is editing.

## The idea

Every AI app-builder differs at exactly one place: **what is being edited**. One edits a file tree.
Another edits a single markup document. The conversation, the streaming, the undo and the preview
are the same in all of them.

So this package owns the loop, and the artifact reaches it through one small port:

```ts
interface EditTarget {
  listParts(): Promise<readonly PartRef[]>;      // the allowlist
  readPart({ id }): Promise<string>;
  replacePart({ id, content }): Promise<void>;   // upsert
  snapshot(): Promise<Snapshot>;
  restore({ snapshot }): Promise<void>;
  validate(candidate): Promise<ValidationResult>;
}
```

A file-tree host maps parts to files. A single-document host maps them to addressable regions.
Neither reimplements the loop.

## Layout

| entry | runtime | contents |
| --- | --- | --- |
| `.` | universal | re-exports `./core` |
| `./core` | universal | the loop and the `EditTarget` port — no React, no Node, no DOM |
| `./html` | universal | the tagged-region, single-HTML-document `EditTarget` (parser injected) |
| `./html/node` | node | a parse5-backed `HtmlRegionParser` for `./html`, for a Node host |
| `./session` | universal | Sessions and registered/direct tools; no React import |
| `./node` | node | Real local file trees, whole-turn validation, capture, journal recovery and exact history |
| `./react` | browser | Session/tool re-exports, hooks and file-viewer/renderer components |

`./node` supplies a file-tree project behind the same `EditTarget` port. The host selects the
real working directory and a private state directory outside the app root. React is an **optional** peer of
`./react`: keeping the framework-free half importable without a UI dependency is the point of the
split, not a stylistic preference, and importing `.`/`./core`/`./html` never pulls React in.

### `./react`

The chat + preview surface over any `EditTarget`: `createVibecodingSession` (a subscribable
wrapper over `./core`'s loop, built for `useSyncExternalStore`), `createVibecodingToolRegistrations`
/`createVibecodingToolRunner` (the same session exposed as `@jini-ai/core` `ToolDescriptor`s a chat
surface discovers through a registry rather than a hardcoded list), and three React pieces —
`PartsViewer` (the file viewer), `DocumentPreview` (the live renderer, a sandboxed iframe — not an
editor, and not `@jini-ai/sandbox`'s job; see that component's own doc), and `VibecodingWorkbench`
(both composed). See `src/react/index.ts` and each module's own doc comment for the design
rationale behind every one of those pieces.

## Three decisions worth knowing before changing anything

**1. `listParts` is an allowlist, and that is where scope discipline comes from.**
A part not listed is structurally unaddressable rather than merely discouraged. Prompt severity is
not a substitute for this — one shipped builder ships three prompt variants that enforce identical
scope rules with wildly different tone, over an identical mechanism. The constraint lives in the
addressing.

**2. `validate` receives the whole prospective artifact, and it is the one piece with no upstream.**
Neither reference implementation validates writes at all, because their unit is a whole file and a
malformed file cannot corrupt another file's syntax. Sub-document parts lose that property: one
unbalanced tag corrupts everything after it. It takes the whole prospective artifact rather than the
part alone because a fragment that is well-formed in isolation can still break the document it lands
in. A rejection's `reason` is written for the model and fed back as its next turn — that is what
closes the loop between validation and correction.

**3. `snapshot` restores data, never an execution environment.**
The reference implementation this shape came from also replays setup commands on rewind to restart
its dev server. That is execution resync, and it is the host's job, after `restore` returns. Folding
it in here would promise something this package cannot deliver for any host but the simplest.

There are deliberately **no verbs for running processes, installing dependencies, or building**.
Those are real needs for a file-tree host and belong to a separate execution layer. Their absence is
a decision, not a gap.

## Usage

```ts
import { applyEdits, correctionsFor } from "@jini-ai/vibecoding/core";

const outcomes = await applyEdits({ target, edits: proposals });
const corrections = correctionsFor({ outcomes });
if (corrections.length > 0) {
  // Feed these back as the model's next turn.
}
```

Every proposal gets an outcome — a rejection or a write failure does not abandon the batch, so a
host can report precisely which parts landed. Write failures surface as `failed` rather than being
logged and forgotten.

## Object API

Functions with inputs take a required object followed, when needed, by an optional object.
Dependencies are explicit ports in the required object. Methods with no inputs stay zero-argument;
React components keep their props and framework callbacks keep the framework's signature.

| API | Call shape |
| --- | --- |
| Single edit | `applyEdit({ target, edit })` |
| Batch edits and feedback | `applyEdits({ target, edits })`, `correctionsFor({ outcomes })` |
| History | `createEditHistory({ target }, { limit })` |
| Transaction / snapshot rewind | `history.transaction({ work }, { label })`, `history.restore({ snapshot })` |
| HTML target | `createHtmlRegionTarget({ store, parser }, { maxPartLength })` |
| Handle check / parser | `isValidRegionHandle({ handle })`, `createParse5RegionParser()` |
| Parser port | `parser.findRegions({ html })`, `parser.checkWellFormed?.({ html })` |
| Document store port | `store.read()`, `store.write({ html })` |
| Session | `createVibecodingSession({ target }, { historyOptions?, history?, applyTurn? })` |
| Session methods | `session.subscribe({ listener })`, `session.readPart({ id })`, `session.applyEdits({ edits }, { label })`, `session.restoreSnapshot({ snapshot })` |
| React hook | `useVibecodingSession({ session })`; its `readPart` and `applyEdits` actions use the session method shapes |
| Registered tools | `createVibecodingToolRegistrations({ session }, { policy })` |
| Direct tool runner | `createVibecodingToolRunner({ session })`, `runner.run({ toolId, input })` |

`createParse5RegionParser()` always provides `checkWellFormed({ html })`; optional chaining
is only needed when working with the generic `HtmlRegionParser` port.

`VibecodingSessionArgs` holds the required target; `VibecodingSessionOptions` holds optional
`historyOptions`, injected `history` and whole-turn `applyTurn`. `UseVibecodingSessionArgs` and `VibecodingToolArgs` describe the required
session port. All are exported from `./session` and re-exported from `./react`. Tool input JSON remains unchanged: `edits` and
`label` still belong to the same tool input object.

```ts
import { createHtmlRegionTarget, type HtmlDocumentStore } from '@jini-ai/vibecoding/html';
import { createParse5RegionParser } from '@jini-ai/vibecoding/html/node';
import {
  createVibecodingSession, createVibecodingToolRunner, VIBECODING_TOOL_IDS,
} from '@jini-ai/vibecoding/react';

let html = '<section data-agent-element="hero">Hello</section>';
const store: HtmlDocumentStore = {
  read: async () => html,
  write: async ({ html: next }) => { html = next; },
};
const target = createHtmlRegionTarget({ store, parser: createParse5RegionParser() });
const session = createVibecodingSession({ target }, { historyOptions: { limit: 25 } });
const runner = createVibecodingToolRunner({ session });
await runner.run({
  toolId: VIBECODING_TOOL_IDS.PROPOSE_EDITS,
  input: { edits: [{ id: 'hero', content: 'Hello again' }], label: 'Greeting' },
});
await session.undo();
```

The parser import above is for a Node host. Browser hosts inject a browser-compatible
`HtmlRegionParser` through the same port. Storage paths, persistence and product configuration
belong to the host. Integration verification is deferred by owner directive; see
[INTEGRATION-REPORT.md](./INTEGRATION-REPORT.md) for the source review and pending commands.

## Design decisions

- [Ambiguous region detection refuses rather than dropping a handle](docs/decisions/DR-001-conservative-region-detection.md).


## Local app projects

```ts
import { openFileTreeProject, type ProjectFilesystemPort } from '@jini-ai/vibecoding/node';
import { createGuardedFileReader, createNodeGuardedReaderFilesystem, withFileLock,
  writeFileAtomicAsync, writeJsonFileAtomicAsync } from '@jini-ai/platform/fs';
import { createVibecodingSession } from '@jini-ai/vibecoding/session';

// The host binds the existing platform owners once at composition.
const filesystem: ProjectFilesystemPort = {
  createReader: (input, options = {}) => createGuardedFileReader({
    ...input, filesystem: createNodeGuardedReaderFilesystem({}),
  }, options),
  withFileLock, writeFileAtomicAsync, writeJsonFileAtomicAsync,
};
const project = await openFileTreeProject({
  filesystem,
  root: appDirectory,
  stateDir: privateHostStateDirectory, // outside appDirectory: dev servers must never serve history
  policy: { allows: ({ relativePath }) => allowedAppPath(relativePath) },
  // Optional validator.validate({candidate, signal}) checks the entire candidate once.
});
const session = createVibecodingSession({ target: project.target }, {
  history: project.history,
  applyTurn: project.applyEdits,
});
await project.applyTurn({
  expectedRevision: await project.capture(),
  changes: [{ op: 'create', relativePath: 'src/App.tsx', content: appSource }],
});
await session.undo(); // removes the created file and its empty managed folders
await project.close();
```

PartIds are canonical relative paths. Explicit creates need no reservation; replacements/deletes
must name existing parts. The root remains the real working tree watched by Vite and other local
dev servers; dependencies, secrets and generated output are excluded. `capture()` records npm,
editor or user drift before a turn/undo so it is not silently overwritten. Revisions deduplicate
unchanged bytes in objects plus manifests. A pending journal rolls interrupted materialization
forward on reopen. History is session-local; another writer's generation clears it and returns `CONFLICT`.

Defaults: 2000 files, 2 MiB/file, 64 MiB/tree, depth 32, 100 changes/turn, 30-second validation,
50 history entries, and 200-character relative paths. A host allowlist always intersects mandatory
exclusions. Candidate-wide case/NFC checks permit case-only rename turns; nonportable names and
physical escapes refuse. Snapshots may expire once no longer retained by current/undo/redo.

Read [Node projects](docs/spec/api.spec.md#node-projects), the
[error table](docs/spec/errors.spec.md#node-project-errors), and
[DR-002](docs/decisions/DR-002-file-tree-revisions.md) for recovery and authority limits. No process,
package-install, compiler, preview or deployment implementation is included in this step.
