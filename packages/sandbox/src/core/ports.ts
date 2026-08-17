/**
 * @file Backend-neutral execution contracts.
 *
 * Purpose:
 * The vocabulary a host talks to a running sandbox through, with no statement about which
 * backend that is. Every declaration here is an `interface`/`type` that erases at compile time,
 * so this module contributes zero bytes and zero `require()` calls to a consumer's runtime graph.
 * `SandboxOperationError` — the error type these methods reject with — lives in `errors.ts`
 * instead, specifically so that claim stays true here rather than becoming "true except for one
 * class." See `errors.ts`'s own doc comment for why it needs to be real runtime code.
 *
 * How it relates to the package:
 * `core` is the half of `@jini-ai/sandbox` that must stay installable with no adapter present —
 * a host that hasn't decided on E2B/local/WebContainer yet can still depend on `./core` for
 * types and never compile `@e2b/code-interpreter`. That property is enforced the same way
 * `@jini-ai/infra`'s `db/core` enforces it against `better-sqlite3`: `pnpm guard`'s R12 check
 * walks this directory's transitive import closure and fails if it reaches an adapter folder or
 * an adapter package. See `scripts/check-driver-isolation.ts`.
 *
 * Architectural role:
 * Ports. Adapters under `<adapter>/` implement `SandboxProviderPort`; host domain code depends
 * on these and never on an adapter. The direction is one-way — `e2b` may import `core`, never
 * the reverse — which is what lets `local` and `webcontainer` land later without restructuring
 * either side.
 *
 * Three adapters are intended against this shape, only the first of which exists yet:
 *   - `e2b` (remote Firecracker microVM, this package's Slice 1) — a `PreviewTarget.url` is a
 *     forwarded public host, `boot()` genuinely takes seconds, the project root starts empty.
 *   - `local` (desktop: spawn `npm`/`vite` on the user's own machine, not yet built) — a
 *     `PreviewTarget.url` is `http://localhost:<port>`, `boot()` can resolve near-instantly, and
 *     the project root is the user's real, possibly-non-empty directory.
 *   - `webcontainer` (browser-only, blocked on WebContainers' commercial licensing, not yet
 *     built) — same shape again, just running in a tab instead of a VM or a desktop process.
 * Both `e2b` and `local` are confirmed shipping targets — a host app that ships as both web and
 * desktop needs the same project editable on either with identical observable results (same
 * files in, same build/preview behavior out), not "one plus a maybe." A remote server-side
 * backend other than E2B (e.g. Modal) is plausible later too; nothing below assumes E2B
 * specifically — see the per-type notes for what was checked against that possibility.
 *
 * Nothing below may assume the sandbox is remote, that a preview is a public URL rather than
 * `localhost`, or that `boot` is slow. A verb that only makes sense for one of the three belongs
 * on that adapter's own class, not here — see the package README for what got excluded on that
 * basis (session reconnection by ID, framework-specific scaffolding verbs).
 *
 * One asymmetry could NOT be unified away, so it's named here instead of papered over: `local`'s
 * project root is the user's real directory and may already contain files this package never
 * mounted (a `.git/` folder, files the user edited outside the sandbox entirely); `e2b`'s (and
 * any other remote adapter's) project root starts empty except for what gets mounted into it.
 * Nothing here promises the project root's contents are fully described by what this session's
 * caller has mounted — code built against this interface must tolerate a project root that
 * already has things in it.
 */

/**
 * A file to place at a path relative to the sandbox's project root. `content` is a plain
 * `string` for text — UTF-8 by convention — or raw bytes for anything else. Theme assets under
 * `assets/images|fonts|video|audio` (`.png`, `.woff2`, `.mp4`, …) are exactly why this isn't
 * `string` alone: mounting a `.woff2` as UTF-8 text would silently corrupt it, and "silently" is
 * the dangerous part — it would look like it worked. `Uint8Array` rather than `ArrayBuffer` or a
 * base64 string because it's what both Node (`Buffer` already extends it) and the browser share
 * with no conversion — the same reason `readFile` returns it below.
 */
export interface SandboxFile {
  readonly path: string;
  readonly content: string | Uint8Array;
}

/** The result of running one command to completion. */
export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Where the running dev server can currently be reached. Deliberately just a `url`, not a
 * `publicUrl` — a local adapter returns `http://localhost:5173`, a remote one returns a
 * forwarded host. Neither is more "canonical" than the other, and core must not encode a
 * preference between them. Port allocation and port conflicts are a `local`-only concern (an
 * already-bound port is meaningless for a fresh remote VM) and deliberately have no
 * representation here — they surface as a `SandboxOperationError` with category `'port-in-use'`
 * from whichever call first hits the conflict (typically `boot` or `startProcess`), not as a
 * field on this type.
 */
export interface PreviewTarget {
  readonly url: string;
}

/** What kind of change a sandbox-originated file event represents. */
export type FileChangeKind = 'created' | 'modified' | 'deleted';

/**
 * A file change the sandbox made on its own — a lockfile write from `installDependencies`, an
 * HMR-triggered rewrite from the dev server itself. Not a notification of changes the host made
 * through `mountFiles`; those are already known to the caller that made them. `path` carries no
 * content — call `readFile` in response if the caller needs to know what actually changed.
 */
export interface FileChangeEvent {
  readonly path: string;
  readonly kind: FileChangeKind;
}

/** Stops a previously registered listener from receiving further events. */
export type Unsubscribe = () => void;

/** One line of output from a still-running process, tagged by which stream it came from. Shared
 *  by `runCommand`'s optional live-output callback and `startProcess`'s `ProcessHandle` — one
 *  chunk shape for both rather than a second one for the foreground case. */
export interface ProcessOutputChunk {
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;
}

/**
 * A still-running process the caller can observe and stop — what `startProcess` returns for a
 * command that is not expected to exit on its own. This exists because `getPreview` is only
 * meaningful once something like a dev server is listening, and a dev server is by definition a
 * command `runCommand`'s "wait for it to finish" contract cannot represent. All three intended
 * adapters have a native shape for this (E2B's `commands.run(..., { background: true })`, a
 * detached `child_process.spawn`, a WebContainer `process.spawn`), so it belongs in core rather
 * than being adapter-specific.
 */
export interface ProcessHandle {
  /** Stop the process. Resolves once it has actually stopped. */
  kill(): Promise<void>;
  /** Subscribe to output as it's produced. Returns an `Unsubscribe`. */
  onOutput(listener: (chunk: ProcessOutputChunk) => void): Unsubscribe;
}

/** Options shared by `runCommand` and `installDependencies` for observing output while the
 *  command is still in flight, without changing what either resolves with. */
export interface RunCommandOptions {
  /** Called for each chunk of output as it's produced. The command the owner most wants to
   *  watch live — `npm install` — exits on its own and therefore goes through `runCommand`/
   *  `installDependencies`, not `startProcess`; without this, that output would be invisible
   *  until the whole install finished and then arrive as one frozen wall of text. */
  readonly onOutput?: (chunk: ProcessOutputChunk) => void;
}

/**
 * One running sandbox instance: a project root plus a process the host can install into,
 * command, preview, and watch. `SandboxProviderPort.boot()` returns this; every other verb
 * happens through it. Every method below rejects with `SandboxOperationError` on failure.
 */
export interface SandboxSession {
  /**
   * Write (create or overwrite) files at their given paths. Upsert only — never deletes a file
   * that isn't in `files`, on any adapter. This is not a simplification made for `e2b`'s sake: on
   * `local`, `mountFiles` operates on the user's real project directory, so "replace the tree"
   * would mean deleting files the user never gave this session permission to touch (a `.git/`
   * folder, anything edited outside the sandbox). Because delete-by-omission is unsafe on
   * `local`, upsert-only is the one semantic that's actually safe and correct on every adapter —
   * there's no seam to name here, both backends already want the same behavior. A caller that
   * needs to remove a file is out of scope for this package's first slice.
   */
  mountFiles(files: readonly SandboxFile[]): Promise<void>;

  /** Read one file's current bytes. Always returns raw bytes, never a decoded string — a caller
   *  that knows a path is text decodes it itself (`new TextDecoder().decode(...)`); guessing
   *  encoding from a path or extension is exactly the kind of silent-corruption risk
   *  `SandboxFile.content` exists to avoid on the write side. Rejects with category `'not-found'`
   *  if nothing exists at `path`. */
  readFile(path: string): Promise<Uint8Array>;

  /** List every file under `directory` (default: the project root), as paths relative to the
   *  project root — the same convention `SandboxFile.path` and `FileChangeEvent.path` use. */
  listFiles(directory?: string): Promise<readonly string[]>;

  /** Run one command and wait for it to exit. Not for commands that don't exit on their own —
   *  see `startProcess` for those. `options.onOutput`, if given, is called with each chunk as
   *  it's produced; the command still resolves with the complete `CommandResult` once it exits,
   *  callers that only need the final result can ignore the option entirely. */
  runCommand(
    command: string,
    args?: readonly string[],
    options?: RunCommandOptions,
  ): Promise<CommandResult>;

  /**
   * Install dependencies: the sandbox's package manager with no args when `packages` is
   * omitted, or install exactly the named packages when given. Kept distinct from `runCommand`
   * rather than left as a caller-composed shell string because the three intended adapters have
   * genuinely different install mechanics, not just different shells. Takes the same
   * `RunCommandOptions` as `runCommand` for the same reason: `npm install`'s scrolling output is
   * exactly what a live terminal view needs to show, and it exits on its own rather than running
   * forever, so it belongs here rather than behind `startProcess`.
   */
  installDependencies(
    packages?: readonly string[],
    options?: RunCommandOptions,
  ): Promise<CommandResult>;

  /** Start a command that is not expected to exit on its own — a dev server, most importantly.
   *  Returns as soon as the process has started, not once it's ready; use `getPreview` to find
   *  out once something is actually listening. */
  startProcess(command: string, args?: readonly string[]): Promise<ProcessHandle>;

  /** Where the dev server can currently be reached. Rejects (category `'timeout'`, typically) if
   *  nothing is listening yet. */
  getPreview(): Promise<PreviewTarget>;

  /** Subscribe to file changes the sandbox makes on its own. Returns an `Unsubscribe`. */
  onFileChange(listener: (event: FileChangeEvent) => void): Unsubscribe;

  /**
   * Stop the sandbox and free its resources: every process this session started via
   * `startProcess` is killed — a dev server that outlives `teardown` is, on `local`, an orphaned
   * process holding a port on the user's own machine forever, so this is a hard requirement, not
   * a nice-to-have. Never deletes the project root's files. On a remote adapter that's moot (the
   * whole disposable VM goes away, and the user's real files were never in it to begin with); on
   * `local`, where the project root IS the user's real directory, `teardown` must not touch the
   * filesystem at all beyond stopping the processes it started. The session is unusable after
   * this resolves.
   */
  teardown(): Promise<void>;
}

/**
 * What a provider needs to start a session. Kept minimal on purpose: provider-specific options
 * (an E2B API key, a local working directory root) belong on each adapter's own constructor or
 * options type, not here — folding them in would make `core` describe backends it can't see.
 */
export interface BootOptions {
  /** Hint for which base template/image to start from. Meaning is adapter-specific. */
  readonly template?: string;
}

/**
 * The provider-level port: turns a still-cold environment into a running `SandboxSession`.
 * Implemented once per backend. Rejects with `SandboxOperationError` — category `'unavailable'`
 * for "couldn't reach or start the backend at all" (network failure, quota exceeded, `node` not
 * on `PATH`), `'port-in-use'` for a pre-boot port conflict a `local` adapter can detect early,
 * `'permission-denied'` for a rejected credential or an unwritable local directory.
 */
export interface SandboxProviderPort {
  boot(options?: BootOptions): Promise<SandboxSession>;
}
