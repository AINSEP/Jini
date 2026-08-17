/**
 * @file Backend-neutral execution contracts.
 *
 * Purpose:
 * The vocabulary a host talks to a running sandbox through, with no statement about which
 * backend that is. Every declaration here is an `interface`/`type` that erases at compile time,
 * so this module contributes zero bytes and zero `require()` calls to a consumer's runtime graph.
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
 *     forwarded public host, `boot()` genuinely takes seconds.
 *   - `local` (desktop: spawn `npm`/`vite` on the user's own machine, not yet built) — a
 *     `PreviewTarget.url` is `http://localhost:<port>`, `boot()` can resolve near-instantly.
 *   - `webcontainer` (browser-only, blocked on WebContainers' commercial licensing, not yet
 *     built) — same shape again, just running in a tab instead of a VM or a desktop process.
 * Nothing below may assume the sandbox is remote, that a preview is a public URL rather than
 * `localhost`, or that `boot` is slow. A verb that only makes sense for one of the three belongs
 * on that adapter's own class, not here — see the package README for what got excluded on that
 * basis (session reconnection by ID, framework-specific scaffolding verbs).
 */

/** A file to place at a path relative to the sandbox's project root. */
export interface SandboxFile {
  readonly path: string;
  readonly content: string;
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
 * preference between them.
 */
export interface PreviewTarget {
  readonly url: string;
}

/** What kind of change a sandbox-originated file event represents. */
export type FileChangeKind = 'created' | 'modified' | 'deleted';

/**
 * A file change the sandbox made on its own — a lockfile write from `installDependencies`, an
 * HMR-triggered rewrite from the dev server itself. Not a notification of changes the host made
 * through `mountFiles`; those are already known to the caller that made them.
 */
export interface FileChangeEvent {
  readonly path: string;
  readonly kind: FileChangeKind;
}

/** Stops a previously registered listener from receiving further events. */
export type Unsubscribe = () => void;

/** One line of output from a still-running process, tagged by which stream it came from. */
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

/**
 * One running sandbox instance: a project root plus a process the host can install into,
 * command, preview, and watch. `SandboxProviderPort.boot()` returns this; every other verb
 * happens through it.
 */
export interface SandboxSession {
  /** Write (create or overwrite) files at their given paths. Does not run anything. */
  mountFiles(files: readonly SandboxFile[]): Promise<void>;

  /** Run one command and wait for it to exit. Not for commands that don't exit on their own —
   *  see `startProcess` for those. */
  runCommand(command: string, args?: readonly string[]): Promise<CommandResult>;

  /**
   * Install dependencies: the sandbox's package manager with no args when `packages` is
   * omitted, or install exactly the named packages when given. Kept distinct from `runCommand`
   * rather than left as a caller-composed shell string because the three intended adapters have
   * genuinely different install mechanics, not just different shells.
   */
  installDependencies(packages?: readonly string[]): Promise<CommandResult>;

  /** Start a command that is not expected to exit on its own — a dev server, most importantly.
   *  Returns as soon as the process has started, not once it's ready; use `getPreview` to find
   *  out once something is actually listening. */
  startProcess(command: string, args?: readonly string[]): Promise<ProcessHandle>;

  /** Where the dev server can currently be reached. Rejects if nothing is listening yet. */
  getPreview(): Promise<PreviewTarget>;

  /** Subscribe to file changes the sandbox makes on its own. Returns an `Unsubscribe`. */
  onFileChange(listener: (event: FileChangeEvent) => void): Unsubscribe;

  /** Stop the sandbox and free its resources. The session is unusable after this resolves. */
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
 * Implemented once per backend.
 */
export interface SandboxProviderPort {
  boot(options?: BootOptions): Promise<SandboxSession>;
}
