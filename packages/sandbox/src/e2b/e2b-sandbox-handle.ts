/**
 * @file The narrow slice of the E2B SDK this adapter actually calls.
 *
 * Purpose:
 * `@e2b/code-interpreter`'s real `Sandbox` class is much bigger than what this adapter needs
 * (code-execution contexts, chart rendering, Jupyter — none of it relevant to running `npm`
 * commands and a dev server). Depending on this narrower shape instead of the SDK's own type
 * keeps the wrapping logic in `wrap-e2b-sandbox.ts` testable with a plain object literal: no
 * network call, no API key, and no risk of a test silently depending on SDK internals this
 * adapter never touches.
 *
 * Most of this interface is structurally satisfied by a real `Sandbox` instance directly.
 * `files.write` is the one exception: E2B's real `write` is overloaded (a single-file form plus
 * this interface's batch form), and TypeScript's assignability check between an overloaded
 * source and a single-signature target does not reliably pick the matching overload, producing
 * a confusing arity error rather than a real incompatibility. `provider.ts`'s `toE2bHandle`
 * adapts the real `Sandbox` into this interface with one explicit wrapper function for that
 * reason, rather than passing the SDK object straight through.
 *
 * Architectural role:
 * The one place this package's `/e2b` subpath writes down what it assumes E2B's API looks like.
 * If a real `@e2b/code-interpreter` upgrade changes these members, `provider.ts` (which is typed
 * against both this interface and the SDK's real `Sandbox` type) fails to compile — a fast,
 * local signal, rather than a runtime surprise inside `wrap-e2b-sandbox.ts`.
 */

/** The subset of E2B's `CommandResult` this adapter reads. */
export interface E2bCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** The subset of E2B's background `CommandHandle` this adapter reads. */
export interface E2bCommandHandle {
  kill(): Promise<boolean>;
}

export interface E2bRunOptions {
  readonly background?: boolean;
  readonly cwd?: string;
  readonly onStdout?: (data: string) => void;
  readonly onStderr?: (data: string) => void;
}

export interface E2bCommands {
  /** Foreground: resolves once the command exits. Background: resolves once it has started. */
  run(command: string, opts?: E2bRunOptions & { background?: false }): Promise<E2bCommandResult>;
  run(command: string, opts: E2bRunOptions & { background: true }): Promise<E2bCommandHandle>;
}

/** E2B's filesystem event kinds (real values, lowercase — confirmed against the installed
 *  `e2b` package's own `FilesystemEventType` enum, not assumed). `'chmod'` is a permissions
 *  change, not a content change — this adapter deliberately does not surface it (see
 *  `wrap-e2b-sandbox.ts`). */
export type E2bFilesystemEventType = 'chmod' | 'create' | 'remove' | 'rename' | 'write';

export interface E2bFilesystemEvent {
  /** Path relative to the watched directory, per E2B's own `FilesystemEvent.name` doc. */
  readonly name: string;
  readonly type: E2bFilesystemEventType;
}

export interface E2bWatchHandle {
  stop(): Promise<void>;
}

/** One file to write, as E2B's own batch `write` overload takes it. `data` is `string |
 *  ArrayBuffer` — not `Uint8Array` — because that's the real signature; converting a
 *  `Uint8Array` view to a correctly-scoped `ArrayBuffer` is `wrap-e2b-sandbox.ts`'s job, not
 *  this port's. */
export interface E2bWriteEntry {
  readonly path: string;
  readonly data: string | ArrayBuffer;
}

/** E2B's real filesystem-entry kind (`FileType` enum values, confirmed against the installed
 *  `e2b` package). Only `'file'` entries are files; `'dir'` and `'symlink'` are not. */
export type E2bFileType = 'file' | 'dir' | 'symlink';

/** The subset of E2B's `EntryInfo` this adapter reads from `files.list`. */
export interface E2bEntryInfo {
  readonly path: string;
  readonly type?: E2bFileType;
}

export interface E2bFilesystem {
  /** Batched over E2B's own multi-file `write` overload — one round trip for however many
   *  files `mountFiles` is given, not one per file. E2B's real `write` is itself overloaded
   *  (a single-file form in addition to this batch one); `provider.ts` adapts the real
   *  `Sandbox` into this interface with an explicit wrapper function rather than relying on
   *  the real object satisfying this shape structurally — TypeScript's assignability check for
   *  a multi-overload source against a single-signature target picks the wrong overload to
   *  compare against and reports a confusing arity mismatch, so the real SDK is never passed
   *  through as-is. See `provider.ts`'s `toE2bHandle`. */
  write(files: readonly E2bWriteEntry[]): Promise<unknown>;
  /** Always requested as raw bytes (`format: 'bytes'`) — this adapter never asks E2B to decode
   *  text on its behalf, matching `SandboxSession.readFile`'s "always raw bytes" contract. */
  read(path: string, opts: { readonly format: 'bytes' }): Promise<Uint8Array>;
  /** `depth` bounds how deep E2B's own server-side walk goes — see `MAX_LIST_DEPTH` in
   *  `wrap-e2b-sandbox.ts` for why a bound exists at all. */
  list(path: string, opts?: { readonly depth?: number }): Promise<readonly E2bEntryInfo[]>;
  watchDir(
    path: string,
    onEvent: (event: E2bFilesystemEvent) => void,
    opts?: { readonly recursive?: boolean },
  ): Promise<E2bWatchHandle>;
}

/**
 * The E2B sandbox surface this adapter depends on. A real `Sandbox` instance from
 * `@e2b/code-interpreter` satisfies this structurally; tests substitute a plain object.
 */
export interface E2bSandboxHandle {
  readonly commands: E2bCommands;
  readonly files: E2bFilesystem;
  getHost(port: number): string;
  /** `true` if the sandbox was killed, `false` if it was already gone — per the real SDK's
   *  `Sandbox.kill()` signature. */
  kill(): Promise<boolean>;
}
