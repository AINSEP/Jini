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
  readPart(id): Promise<string>;
  replacePart(id, content): Promise<void>;       // upsert
  snapshot(): Promise<Snapshot>;
  restore(snapshot): Promise<void>;
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

`./node` (filesystem targets) and `./react` (chat + preview surface) are planned and deliberately
not present yet. When `./react` lands, React must be an **optional** peer: keeping the
framework-free half importable without a UI dependency is the point of the split, not a stylistic
preference.

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

const outcomes = await applyEdits(target, proposals);
const corrections = correctionsFor(outcomes);
if (corrections.length > 0) {
  // Feed these back as the model's next turn.
}
```

Every proposal gets an outcome — a rejection or a write failure does not abandon the batch, so a
host can report precisely which parts landed. Write failures surface as `failed` rather than being
logged and forgotten.
