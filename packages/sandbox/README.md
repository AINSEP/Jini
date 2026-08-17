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

Tovu is shipping as both a web app and a desktop app. That means "run this project and preview
it" cannot assume a remote VM — it needs a shape that admits at least three real
implementations:

| adapter | where it runs | status |
| --- | --- | --- |
| `./e2b` | a remote Firecracker microVM (E2B) | **built** — this package's Slice 1 |
| `./local` | spawned directly on the user's own machine (desktop) | not built |
| `./webcontainer` | in the browser tab (StackBlitz WebContainers) | not built — blocked on WebContainers' commercial licensing for production use |

E2B was chosen to build first because it is genuinely open source and self-hostable — see the
design docs this package was built from for the full comparison. `./local` is realistic for
desktop because Tovu already spawns local processes today (agent CLIs via PATH detection); on
desktop a hosted sandbox may not be needed at all. `./webcontainer` is browser-only and cannot be
"a package Jini's server imports" the way the other two can.

`./core`'s job is to describe the shape all three can implement, so that building `./local` or
`./webcontainer` later is an adapter, not a redesign. Concretely, nothing in `./core` may assume:

- the sandbox is remote,
- a preview is a public URL rather than `http://localhost:<port>`,
- or that `boot` is slow.

## The interface

```ts
interface SandboxProviderPort {
  boot(options?: BootOptions): Promise<SandboxSession>;
}

interface SandboxSession {
  mountFiles(files: readonly SandboxFile[]): Promise<void>;
  runCommand(command: string, args?: readonly string[]): Promise<CommandResult>;
  installDependencies(packages?: readonly string[]): Promise<CommandResult>;
  startProcess(command: string, args?: readonly string[]): Promise<ProcessHandle>;
  getPreview(): Promise<PreviewTarget>;
  onFileChange(listener: (event: FileChangeEvent) => void): Unsubscribe;
  teardown(): Promise<void>;
}
```

`runCommand` waits for the command to exit. `startProcess` is the separate verb for a command
that is not expected to exit on its own — a dev server, most importantly. That split exists
because `getPreview` is only meaningful once something is listening, and a listening dev server
is by definition a process `runCommand`'s "wait for it to finish" contract cannot represent. All
three intended backends have a native shape for a background process (E2B's
`commands.run(cmd, { background: true })`, a detached `child_process.spawn`, a non-blocking
WebContainer `process.spawn`), which is what makes it belong in `./core` rather than being
`./e2b`-specific.

See `src/core/ports.ts` for the full type definitions and their reasoning — every export there
carries a doc comment explaining what it's for and, where relevant, what alternative was
considered and rejected.

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
  argument is shell-quoted, not just ones that look risky), the `FilesystemEventType` →
  `FileChangeKind` mapping (`chmod` is dropped — a permissions change isn't a content change;
  `rename` maps to `modified` rather than a guessed create/delete, since E2B's event carries only
  one path, not an old/new pair), and `getPreview`'s liveness check.
- `provider.ts` — the one file that imports `@e2b/code-interpreter` itself and calls
  `Sandbox.create()`.
- `default-vite-react-template.ts` — the same starter files open-lovable's `setupViteApp`
  produces, as plain `SandboxFile[]` data. The real `files.write` API this adapter uses takes a
  string directly and creates intermediate directories on its own, so no Python-heredoc script
  is needed to place them the way open-lovable's version required.

**`getPreview` does one bounded-timeout check, not a retry loop.** open-lovable's E2B path starts
Vite and then sleeps a fixed delay before assuming it's ready. This adapter instead does a single
`HEAD` request against the forwarded host with a timeout, and rejects with
`SandboxPreviewNotReadyError` if nothing answers. A caller that wants to poll does so by calling
`getPreview()` again — the retry policy is the caller's to choose, not baked into the adapter.

Every claim in this file about E2B's real API shape (`commands.run`'s `background`/`onStdout`/
`onStderr` options, `files.write` auto-creating parent directories, `files.watchDir`'s event
types being lowercase, `Sandbox.kill()` returning a `boolean`) was checked against the installed
`@e2b/code-interpreter`/`e2b` package's own `.d.ts`, not inferred from open-lovable's source or
paraphrased docs — two of those checks caught real mistakes in an earlier draft before they
shipped.
