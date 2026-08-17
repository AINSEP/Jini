# `@jini-ai/sandbox`

The execution/sandbox sibling to [`@jini-ai/vibecoding`](../vibecoding/README.md)'s edit loop —
boot an environment, mount files, install dependencies, run commands, preview, and tear down,
behind one backend-neutral interface.

```ts
import type { SandboxProviderPort, SandboxSession } from '@jini-ai/sandbox/core';
import { createE2bSandboxProvider } from '@jini-ai/sandbox/e2b';
```

## The split from vibecoding

`@jini-ai/vibecoding`'s `EditTarget` interface deliberately has no verbs for running processes,
installing dependencies, or building — that is a decision documented in its own README, not a
gap. A host composes the two side by side: vibecoding owns the conversational edit loop over an
addressable artifact; this package owns making that artifact actually run somewhere and produce
a preview. Neither package imports the other.

## Why three adapters, and why only one exists yet

A host application that ships as both a web app and a desktop app needs "run this project and
preview it" to not assume a remote VM — it needs a shape that admits at least three real
implementations, with the same project producing identical observable results on any of them
(same files in, same build/preview behavior out):

| adapter | where it runs | status |
| --- | --- | --- |
| `./e2b` | a remote Firecracker microVM (E2B) | **built** — this package's Slice 1 |
| `./local` | spawned directly on the user's own machine (desktop) | not built — confirmed shipping target |
| `./webcontainer` | in the browser tab (StackBlitz WebContainers) | not built — blocked on WebContainers' commercial licensing for production use |

`./e2b` and `./local` are both confirmed shipping targets, not "one plus a maybe" — a project
started on desktop must be continuable in a browser and vice versa. E2B was chosen to build
first because it is genuinely open source and self-hostable — see the design docs this package
was built from for the full comparison. A remote server-side backend other than E2B (Modal, most
plausibly) may join `./e2b` later; nothing in `./core` leans on anything E2B-specific — see the
error-category and content-type sections below for what was checked against that.

`./core`'s job is to describe the shape all three (or four) can implement, so that building
`./local` or `./webcontainer` later is an adapter, not a redesign. Concretely, nothing in
`./core` may assume:

- the sandbox is remote,
- a preview is a public URL rather than `http://localhost:<port>`,
- `boot` is slow,
- file content is always UTF-8 text, or
- the project root starts out empty.

That last one is a real, named asymmetry, not a hidden gap — see below.

## The interface

```ts
interface SandboxProviderPort {
  boot(options?: BootOptions): Promise<SandboxSession>;
}

interface SandboxSession {
  mountFiles(files: readonly SandboxFile[]): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  listFiles(directory?: string): Promise<readonly string[]>;
  runCommand(command: string, args?: readonly string[], options?: RunCommandOptions): Promise<CommandResult>;
  installDependencies(packages?: readonly string[], options?: RunCommandOptions): Promise<CommandResult>;
  startProcess(command: string, args?: readonly string[]): Promise<ProcessHandle>;
  getPreview(): Promise<PreviewTarget>;
  onFileChange(listener: (event: FileChangeEvent) => void): Unsubscribe;
  teardown(): Promise<void>;
}
```

See `src/core/ports.ts` for the full type definitions and their reasoning — every export there
carries a doc comment explaining what it's for and, where relevant, what alternative was
considered and rejected. The headline decisions:

**`runCommand`/`installDependencies` can stream, and still resolve with the final result.**
`RunCommandOptions.onOutput` is called with each output chunk as it's produced; the command still
resolves with the complete `CommandResult` once it exits. This exists specifically for `npm
install`'s output scrolling live in a terminal panel — it's a command that exits on its own, so
it goes through `installDependencies`, not `startProcess`, and without this option that output
would be invisible until the whole install finished and then arrive as one frozen wall of text.

**`startProcess`/`ProcessHandle` is the separate verb for a command that never exits.** A dev
server is by definition a process `runCommand`'s "wait for it to finish" contract cannot
represent, and `getPreview` is only meaningful once one is listening. All three intended backends
have a native shape for a background process (E2B's `commands.run(cmd, { background: true })`, a
detached `child_process.spawn`, a non-blocking WebContainer `process.spawn`), which is what makes
it belong in `./core` rather than being `./e2b`-specific.

**`SandboxFile.content` is `string | Uint8Array`, and `readFile` always returns raw bytes.**
A theme's assets (`.png`, `.woff2`, `.mp4`, under `assets/images|fonts|video|audio`) cannot
round-trip through a UTF-8 string — mounting one as text would silently corrupt it, which is the
dangerous part, since it would look like it worked. `readFile` never guesses whether a path is
text or binary; a caller that knows decodes it itself.

**`mountFiles` is upsert-only on every adapter — never delete-by-omission.** Not an
E2B-shaped simplification: on `./local`, `mountFiles` operates on the user's real project
directory, so "replace the tree" would mean deleting files the session was never given
permission to touch (a `.git/` folder, anything edited outside the sandbox). Both backends
independently want identical behavior here, so there's no seam to name — explicit file deletion
is out of scope for this package's first slice.

**`teardown` has two hard guarantees, stated as contract:** every process started via
`startProcess` is killed (an orphaned dev server on `./local` would hold a port on the user's
machine forever), and the project root's files are never deleted (moot on a disposable remote
VM; a hard requirement on `./local`, where the project root IS the user's real directory).

**The one asymmetry that could not be unified, named rather than papered over:** `./local`'s
project root is the user's real directory and may already contain files this package never
mounted; `./e2b`'s (and any other remote adapter's) project root starts empty except for what
gets mounted into it. Code built against this interface has to tolerate a project root that
already has things in it.

## Errors

Every `SandboxSession`/`SandboxProviderPort` method rejects with `SandboxOperationError` — a real
class (`src/core/errors.ts`, not `ports.ts`, so `ports.ts` stays truthfully zero-runtime; see its
own doc comment for why) carrying one of six backend-neutral categories: `unavailable`,
`permission-denied`, `port-in-use`, `not-found`, `timeout`, `unknown`. A caller branches on
`category`, never on which adapter it's talking to — "network down" (E2B) and "node isn't
installed" (local) are different causes for the same `'unavailable'` category. The standard
`Error` `cause` field is the escape hatch for the backend's own detail.

Named `SandboxOperationError` rather than `SandboxError` because `@e2b/code-interpreter`'s own
base SDK (`e2b`) already exports a class literally called `SandboxError` — importing both into
the same adapter file under the obvious names would collide.

## What got deliberately left out of `./core`, and why

Ported from open-lovable's `SandboxProvider`/`E2BProvider`, but NOT carried into the
backend-neutral interface:

- **Session reconnection by ID.** E2B's real SDK supports `Sandbox.connect(sandboxId)` (open-
  lovable's own `reconnect()` stub predates that and just returns `false` — verified against the
  installed `e2b` package's types, not assumed from the older code). It still doesn't belong in
  `./core`: a local desktop process isn't "reconnectable" the same way after the host restarts,
  and a WebContainer instance dies with the browser tab. This is an E2B-adapter-only concern if
  it's ever needed, not a port verb.
- **Framework-specific scaffolding verbs.** open-lovable's abstract `SandboxProvider` bakes
  `setupViteApp()`/`restartViteServer()` directly into the interface, assuming every project is a
  Vite app. `./core` knows nothing about Vite, React, or any framework. Scaffolding a starter
  template is the host's job — call `mountFiles` with template files, then `startProcess` with
  whatever dev command applies. `./e2b`'s `DEFAULT_VITE_REACT_TEMPLATE` is offered as a
  convenience for hosts that want one, not as part of the required adapter surface.
- **A session registry keyed by sandbox ID.** open-lovable's `SandboxManager` singleton exists
  because each Next.js API route is a fresh serverless invocation with no memory between
  requests. Jini's daemon is long-running, so a `SandboxSession` return value is already a live
  handle a host can hold onto — no registry concept is needed in `./core`.

## `./e2b`

`createE2bSandboxProvider(config?)` implements `SandboxProviderPort` against a real E2B
Firecracker microVM. `@e2b/code-interpreter` is an **optional peer dependency** — installing
`@jini-ai/sandbox` alone pulls no E2B SDK code, and `pnpm guard`'s R12 check (opted in via
`jini.neutralEntries` in `package.json`, the same mechanism `@jini-ai/infra` uses for its
database drivers) fails the build if anything under `./core` ever imports it.

Structurally:

- `e2b-sandbox-handle.ts` — the narrow slice of `@e2b/code-interpreter`'s `Sandbox` this adapter
  actually calls, written as its own interface. This is what makes the wrapping logic testable
  against a plain object literal instead of a real, network-backed sandbox.
- `wrap-e2b-sandbox.ts` — all of the E2B-specific translation: shell command building (every
  argument is shell-quoted, not just ones that look risky), binary-content conversion, the
  `FilesystemEventType` → `FileChangeKind` mapping (`chmod` is dropped — a permissions change
  isn't a content change; `rename` maps to `modified` rather than a guessed create/delete, since
  E2B's event carries only one path, not an old/new pair), `getPreview`'s liveness check, and
  process tracking so `teardown` can kill everything `startProcess` started.
- `categorize-e2b-error.ts` — maps E2B SDK error *names* (not imported classes — see the file's
  own doc) onto `SandboxErrorCategory`.
- `to-array-buffer.ts` — converts a `Uint8Array` to the `ArrayBuffer` E2B's `files.write` accepts,
  correctly handling a view with a non-zero `byteOffset` over a larger shared buffer.
- `provider.ts` — the one file that imports `@e2b/code-interpreter` itself, calls
  `Sandbox.create()`, and adapts the result into `E2bSandboxHandle` via `toE2bHandle`. That
  adaptation is an explicit wrapper function, not a direct structural pass-through of the real
  `Sandbox` object, because TypeScript's assignability check between E2B's overloaded `write`
  (single-file and batch forms) and this interface's batch-only signature doesn't reliably
  resolve to the matching overload — a real, reproduced compile error, not a theoretical concern.
- `default-vite-react-template.ts` — the same starter files open-lovable's `setupViteApp`
  produces, as plain `SandboxFile[]` data. The real `files.write` API this adapter uses takes a
  string directly and creates intermediate directories on its own, so no Python-heredoc script
  is needed to place them the way open-lovable's version required.

**`getPreview` does one bounded-timeout check, not a retry loop.** open-lovable's E2B path starts
Vite and then sleeps a fixed delay before assuming it's ready. This adapter instead does a single
`HEAD` request against the forwarded host with a timeout, and rejects (category `'timeout'`) if
nothing answers. A caller that wants to poll does so by calling `getPreview()` again — the retry
policy is the caller's to choose, not baked into the adapter.

**`mountFiles` writes every file in one batched call**, using E2B's multi-file `write` overload —
one network round trip regardless of how many files are given, not one per file.

**One assumption flagged for verification, not confirmed against a live sandbox:** `listFiles`
assumes `files.list`'s `EntryInfo.path` is absolute, inferred from its type-level doc plus this
adapter always calling `write`/`list` with absolute paths — no E2B credentials were available
while building this. `relativeToRoot` in `wrap-e2b-sandbox.ts` is the one place to change if a
real sandbox's `list()` turns out to echo paths differently.

Every other claim in this file about E2B's real API shape (`commands.run`'s
`background`/`onStdout`/`onStderr` options working on foreground calls too, `files.write`
auto-creating parent directories, `files.read`'s `format: 'bytes'` returning `Uint8Array`
natively, `files.watchDir`'s event types being lowercase, `Sandbox.kill()` returning a
`boolean`) was checked against the installed `@e2b/code-interpreter`/`e2b` package's own `.d.ts`,
not inferred from open-lovable's source or paraphrased docs — several of those checks caught
real mistakes in earlier drafts before they shipped.
