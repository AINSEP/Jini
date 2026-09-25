/**
 * @file Wraps a raw E2B sandbox handle into a `SandboxSession`.
 *
 * Purpose:
 * All of the E2B-specific translation lives here: building shell command strings from
 * `command`/`args`, mapping E2B's filesystem event vocabulary onto core's `FileChangeKind`,
 * converting binary content to what E2B's `files.write` accepts, and turning every failure into
 * a `SandboxOperationError`. Deliberately separated from `provider.ts`'s `Sandbox.create()` call
 * so this logic is testable against a plain object literal — no network call, no API key, and
 * (per `categorize-e2b-error.ts`'s own doc) no import of the real SDK at all.
 *
 * Architectural role:
 * Driver-side implementation of `@jini-ai/sandbox/core`'s `SandboxProviderPort`/`SandboxSession`
 * ports. Imports from `../core/*`, never the reverse.
 */
import { posix } from 'node:path';

import { SandboxOperationError } from '../core/errors.js';
import type {
  CommandResult,
  FileChangeEvent,
  FileChangeKind,
  PreviewTarget,
  ProcessHandle,
  ProcessOutputChunk,
  RunCommandOptions,
  SandboxSession,
  Unsubscribe,
} from '../core/ports.js';
import { categorizeE2bError } from './categorize-e2b-error.js';
import type { E2bFilesystemEventType, E2bSandboxHandle } from './e2b-sandbox-handle.js';
import { shellQuote } from './shell-quote.js';
import { toArrayBuffer } from './to-array-buffer.js';

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

/**
 * Bound on `files.list`'s server-side recursion depth. A theme project's own tree is small, but
 * nothing stops `listFiles` from being pointed at a directory containing a much larger one — an
 * unbounded walk is exactly the kind of external-call resource risk that needs a cap rather than
 * an assumption that inputs stay small. 20 is generous for a theme's own files while still being
 * a real bound, not `Infinity` spelled differently.
 */
const MAX_LIST_DEPTH = 20;

/** Directory names `listFiles` excludes from its results — dependency/build/VCS noise a caller
 *  asking "what's in this theme" almost never wants, and `node_modules` specifically can be
 *  enormous. Mirrors the filter open-lovable's own `listFiles` implementation used. */
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'build', '.next']);

/** Thrown by `getPreview` when a single check finds nothing listening on `previewPort` yet. Not
 *  a retry loop — callers that want to poll do so by calling `getPreview` again. */
function previewNotReadyError(url: string, cause: unknown): SandboxOperationError {
  return new SandboxOperationError('timeout', `Sandbox preview at ${url} is not responding yet`, {
    cause,
  });
}

/** Wraps anything caught from an `E2bSandboxHandle` call into a `SandboxOperationError`. */
function wrapE2bError(error: unknown, message: string): SandboxOperationError {
  return new SandboxOperationError(categorizeE2bError(error), message, { cause: error });
}

/** Builds one shell command string from a program name and shell-quoted arguments. The program
 *  name itself is not quoted — see `shell-quote.ts` for why. */
function buildCommand(command: string, args: readonly string[]): string {
  return args.length === 0 ? command : `${command} ${args.map(shellQuote).join(' ')}`;
}

function toCommandResult(result: { stdout: string; stderr: string; exitCode: number }): CommandResult {
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

/** Converts `SandboxFile.content` into what E2B's `files.write` actually accepts (`string |
 *  ArrayBuffer`, no `Uint8Array` overload). */
function toE2bWriteData(content: string | Uint8Array): string | ArrayBuffer {
  return typeof content === 'string' ? content : toArrayBuffer(content);
}

/**
 * The `onStdout`/`onStderr` fragment to spread into an E2B `commands.run` call — present only
 * when `options.onOutput` is given. Built with a conditional spread rather than
 * `onStdout: options?.onOutput ? fn : undefined` because this package's `exactOptionalPropertyTypes`
 * makes an explicit `undefined` on an optional key a type error distinct from the key being
 * absent; omitting the keys entirely is both what's needed and what compiles.
 */
function streamingOptsFor(options: RunCommandOptions | undefined) {
  const onOutput = options?.onOutput;
  if (!onOutput) return {};
  return {
    onStdout: (text: string) => onOutput({ stream: 'stdout', text }),
    onStderr: (text: string) => onOutput({ stream: 'stderr', text }),
  };
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

/**
 * Strips a `projectRoot` prefix off an absolute E2B path, producing the project-root-relative
 * path convention `SandboxFile.path`/`FileChangeEvent.path` use.
 *
 * Assumption flagged for verification: E2B's `EntryInfo.path` is treated here as absolute,
 * inferred from its type-level doc ("Path to the filesystem object") plus this adapter always
 * calling `write`/`list` with absolute paths — not confirmed against a live sandbox, since
 * building this adapter didn't include real E2B credentials. If a real sandbox's `list()` turns
 * out to echo paths relative to the queried directory instead, this function is the one place
 * that needs to change.
 */
function relativeToRoot(absolutePath: string, projectRoot: string): string {
  const prefix = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`;
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : absolutePath;
}

/** True if any path segment matches one of `EXCLUDED_DIR_NAMES`. */
function isExcludedPath(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => EXCLUDED_DIR_NAMES.has(segment));
}

export async function wrapE2bSandbox(
  handle: E2bSandboxHandle,
  config: E2bSessionConfig,
): Promise<SandboxSession> {
  const { projectRoot, previewPort, previewCheckTimeoutMs } = config;

  try {
    await handle.commands.run(`mkdir -p ${shellQuote(projectRoot)}`);
  } catch (error) {
    throw wrapE2bError(error, 'Failed to create the sandbox project root');
  }

  const fileChangeListeners = new Set<(event: FileChangeEvent) => void>();
  let watchHandle: Awaited<ReturnType<E2bSandboxHandle['files']['watchDir']>>;
  try {
    watchHandle = await handle.files.watchDir(
      projectRoot,
      (event) => {
        const kind = mapE2bFileChangeKind(event.type);
        if (kind === null) return;
        const changeEvent: FileChangeEvent = { path: event.name, kind };
        for (const listener of fileChangeListeners) listener(changeEvent);
      },
      { recursive: true },
    );
  } catch (error) {
    throw wrapE2bError(error, 'Failed to start watching the sandbox project root');
  }

  /** Every process this session has started via `startProcess`, so `teardown` can kill them
   *  all — see `SandboxSession.teardown`'s doc for why an orphaned dev server on `local` is a
   *  real liability, not just untidy. A process removes itself once its own `kill()` has been
   *  attempted (succeeded or not), so `teardown` doesn't redundantly re-kill it. */
  const trackedProcesses = new Set<ProcessHandle>();

  return {
    async mountFiles(files) {
      if (files.length === 0) return;
      try {
        await handle.files.write(
          files.map((file) => ({
            path: posix.join(projectRoot, file.path),
            data: toE2bWriteData(file.content),
          })),
        );
      } catch (error) {
        throw wrapE2bError(error, 'Failed to write files into the sandbox');
      }
    },

    async readFile(path) {
      try {
        return await handle.files.read(posix.join(projectRoot, path), { format: 'bytes' });
      } catch (error) {
        throw wrapE2bError(error, `Failed to read ${path}`);
      }
    },

    async listFiles(directory) {
      const base = directory ? posix.join(projectRoot, directory) : projectRoot;
      let entries;
      try {
        entries = await handle.files.list(base, { depth: MAX_LIST_DEPTH });
      } catch (error) {
        throw wrapE2bError(error, `Failed to list files under ${directory ?? '.'}`);
      }
      return entries
        .filter((entry) => entry.type === 'file')
        .map((entry) => relativeToRoot(entry.path, projectRoot))
        .filter((relativePath) => !isExcludedPath(relativePath));
    },

    async runCommand(command, args = [], options) {
      try {
        const result = await handle.commands.run(buildCommand(command, args), {
          cwd: projectRoot,
          ...streamingOptsFor(options),
        });
        return toCommandResult(result);
      } catch (error) {
        throw wrapE2bError(error, `Command failed: ${command}`);
      }
    },

    async installDependencies(packages, options) {
      const command =
        packages && packages.length > 0
          ? `npm install ${packages.map(shellQuote).join(' ')}`
          : 'npm install';
      try {
        const result = await handle.commands.run(command, {
          cwd: projectRoot,
          ...streamingOptsFor(options),
        });
        return toCommandResult(result);
      } catch (error) {
        throw wrapE2bError(error, 'npm install failed');
      }
    },

    async startProcess(command, args = []): Promise<ProcessHandle> {
      const outputListeners = new Set<(chunk: ProcessOutputChunk) => void>();
      let e2bHandle;
      try {
        e2bHandle = await handle.commands.run(buildCommand(command, args), {
          cwd: projectRoot,
          background: true,
          onStdout: (text) => {
            for (const listener of outputListeners) listener({ stream: 'stdout', text });
          },
          onStderr: (text) => {
            for (const listener of outputListeners) listener({ stream: 'stderr', text });
          },
        });
      } catch (error) {
        throw wrapE2bError(error, `Failed to start process: ${command}`);
      }

      const processHandle: ProcessHandle = {
        async kill() {
          trackedProcesses.delete(processHandle);
          try {
            await e2bHandle.kill();
          } catch (error) {
            throw wrapE2bError(error, 'Failed to kill process');
          }
        },
        onOutput(listener): Unsubscribe {
          outputListeners.add(listener);
          return () => outputListeners.delete(listener);
        },
      };
      trackedProcesses.add(processHandle);
      return processHandle;
    },

    async getPreview(): Promise<PreviewTarget> {
      const url = `https://${handle.getHost(previewPort)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), previewCheckTimeoutMs);
      try {
        await fetch(url, { method: 'HEAD', signal: controller.signal });
      } catch (error) {
        throw previewNotReadyError(url, error);
      } finally {
        clearTimeout(timer);
      }
      return { url };
    },

    onFileChange(listener): Unsubscribe {
      fileChangeListeners.add(listener);
      return () => fileChangeListeners.delete(listener);
    },

    async teardown() {
      // Best-effort: every tracked process gets a kill attempt regardless of whether another
      // one fails. A process that refuses to die is a different problem than this adapter can
      // solve; what teardown promises is that killing was attempted, not that it's leakproof
      // against a hung process ignoring SIGKILL.
      await Promise.allSettled([...trackedProcesses].map((process) => process.kill()));

      let watchStopError: unknown;
      try {
        await watchHandle.stop();
      } catch (error) {
        watchStopError = error;
      }

      try {
        await handle.kill();
      } catch (error) {
        // The sandbox failing to terminate is the more severe of the two possible failures
        // here (an un-torn-down VM vs. a watch handle that didn't clean up) — surfaced first.
        throw wrapE2bError(error, 'Failed to terminate the sandbox');
      }

      if (watchStopError !== undefined) {
        throw wrapE2bError(watchStopError, 'Failed to stop watching the sandbox project root');
      }
    },
  };
}
