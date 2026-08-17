/**
 * @file Wraps a raw E2B sandbox handle into a `SandboxSession`.
 *
 * Purpose:
 * All of the E2B-specific translation lives here: building shell command strings from
 * `command`/`args`, mapping E2B's filesystem event vocabulary onto core's `FileChangeKind`,
 * and turning `getHost` into a checked `PreviewTarget`. Deliberately separated from
 * `provider.ts`'s `Sandbox.create()` call so this logic is testable against a plain object
 * literal — no network call, no API key.
 *
 * Architectural role:
 * Driver-side implementation of `@jini-ai/sandbox/core`'s `SandboxProviderPort`/`SandboxSession`
 * ports. Imports from `../core/*`, never the reverse.
 */
import { posix } from 'node:path';

import type {
  CommandResult,
  FileChangeEvent,
  FileChangeKind,
  PreviewTarget,
  ProcessHandle,
  ProcessOutputChunk,
  SandboxSession,
  Unsubscribe,
} from '../core/ports.js';
import type { E2bFilesystemEventType, E2bSandboxHandle } from './e2b-sandbox-handle.js';
import { shellQuote } from './shell-quote.js';

/** Resolved (no optionals) configuration `wrapE2bSandbox` needs. Default-filling happens in
 *  `provider.ts`, which owns the public, partially-optional config type. */
export interface E2bSessionConfig {
  /** Absolute path inside the sandbox that `mountFiles`/`runCommand`/`startProcess` treat as
   *  the project root, and that `onFileChange` watches (recursively). */
  readonly projectRoot: string;
  /** Port `getPreview` asks E2B to forward — the port the caller's dev server binds to. */
  readonly previewPort: number;
  /** How long `getPreview` waits for a single response before deciding nothing is listening. */
  readonly previewCheckTimeoutMs: number;
}

/** Thrown by `getPreview` when a single check finds nothing listening on `previewPort` yet. Not
 *  a retry loop — callers that want to poll do so by calling `getPreview` again. */
export class SandboxPreviewNotReadyError extends Error {
  constructor(
    readonly url: string,
    cause: unknown,
  ) {
    super(`Sandbox preview at ${url} is not responding yet`);
    this.name = 'SandboxPreviewNotReadyError';
    this.cause = cause;
  }
}

/** Builds one shell command string from a program name and shell-quoted arguments. The program
 *  name itself is not quoted — see `shell-quote.ts` for why. */
function buildCommand(command: string, args: readonly string[]): string {
  return args.length === 0 ? command : `${command} ${args.map(shellQuote).join(' ')}`;
}

function toCommandResult(result: { stdout: string; stderr: string; exitCode: number }): CommandResult {
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

/**
 * Maps one E2B filesystem event kind onto core's three-way `FileChangeKind`, or `null` to mean
 * "don't surface this one." `'chmod'` is a permissions change, not a content change, and is
 * dropped for that reason. `'rename'` is mapped to `modified` rather than guessed as
 * create/delete because E2B's event carries only the one path this adapter sees, not an old/new
 * pair — a wrong create-or-delete guess would be more misleading than the conservative
 * "something at this path changed."
 */
export function mapE2bFileChangeKind(type: E2bFilesystemEventType): FileChangeKind | null {
  switch (type) {
    case 'create':
      return 'created';
    case 'write':
    case 'rename':
      return 'modified';
    case 'remove':
      return 'deleted';
    case 'chmod':
      return null;
  }
}

/** Single bounded-timeout liveness check: resolves if `url` answers at all (any HTTP status),
 *  rejects with `SandboxPreviewNotReadyError` on a network-level failure (connection refused,
 *  DNS failure, timeout). A non-2xx response still means something is listening. */
async function checkListening(url: string, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { method: 'HEAD', signal: controller.signal });
  } catch (error) {
    throw new SandboxPreviewNotReadyError(url, error);
  } finally {
    clearTimeout(timer);
  }
}

export async function wrapE2bSandbox(
  handle: E2bSandboxHandle,
  config: E2bSessionConfig,
): Promise<SandboxSession> {
  const { projectRoot, previewPort, previewCheckTimeoutMs } = config;

  await handle.commands.run(`mkdir -p ${shellQuote(projectRoot)}`);

  const fileChangeListeners = new Set<(event: FileChangeEvent) => void>();
  const watchHandle = await handle.files.watchDir(
    projectRoot,
    (event) => {
      const kind = mapE2bFileChangeKind(event.type);
      if (kind === null) return;
      const changeEvent: FileChangeEvent = { path: event.name, kind };
      for (const listener of fileChangeListeners) listener(changeEvent);
    },
    { recursive: true },
  );

  return {
    async mountFiles(files) {
      // E2B's `files.write` creates intermediate directories for a path that doesn't exist yet
      // (confirmed against the installed SDK's own doc comment) — no separate mkdir needed here
      // for nested paths like `src/components/Button.tsx`.
      await Promise.all(
        files.map((file) => handle.files.write(posix.join(projectRoot, file.path), file.content)),
      );
    },

    async runCommand(command, args = []) {
      const result = await handle.commands.run(buildCommand(command, args), { cwd: projectRoot });
      return toCommandResult(result);
    },

    async installDependencies(packages) {
      const command =
        packages && packages.length > 0
          ? `npm install ${packages.map(shellQuote).join(' ')}`
          : 'npm install';
      const result = await handle.commands.run(command, { cwd: projectRoot });
      return toCommandResult(result);
    },

    async startProcess(command, args = []): Promise<ProcessHandle> {
      const outputListeners = new Set<(chunk: ProcessOutputChunk) => void>();
      const e2bHandle = await handle.commands.run(buildCommand(command, args), {
        cwd: projectRoot,
        background: true,
        onStdout: (text) => {
          for (const listener of outputListeners) listener({ stream: 'stdout', text });
        },
        onStderr: (text) => {
          for (const listener of outputListeners) listener({ stream: 'stderr', text });
        },
      });

      return {
        async kill() {
          await e2bHandle.kill();
        },
        onOutput(listener): Unsubscribe {
          outputListeners.add(listener);
          return () => outputListeners.delete(listener);
        },
      };
    },

    async getPreview(): Promise<PreviewTarget> {
      const url = `https://${handle.getHost(previewPort)}`;
      await checkListening(url, previewCheckTimeoutMs);
      return { url };
    },

    onFileChange(listener): Unsubscribe {
      fileChangeListeners.add(listener);
      return () => fileChangeListeners.delete(listener);
    },

    async teardown() {
      try {
        await watchHandle.stop();
      } finally {
        await handle.kill();
      }
    },
  };
}
