/**
 * @file The narrow slice of the E2B SDK this adapter actually calls.
 *
 * Purpose:
 * `@e2b/code-interpreter`'s real `Sandbox` class is much bigger than what this adapter needs
 * (code-execution contexts, chart rendering, Jupyter — none of it relevant to running `npm`
 * commands and a dev server). Depending on this narrower shape instead of the SDK's own type
 * keeps the wrapping logic in `wrap-e2b-sandbox.ts` testable with a plain object literal: no
 * network call, no API key, and no risk of a test silently depending on SDK internals this
 * adapter never touches. TypeScript's structural typing means a real `Sandbox` instance already
 * satisfies this interface with no cast required — see `provider.ts`.
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

export interface E2bFilesystem {
  write(path: string, data: string): Promise<unknown>;
  read(path: string): Promise<string>;
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
