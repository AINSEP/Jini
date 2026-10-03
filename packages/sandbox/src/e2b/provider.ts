/**
 * @file The E2B adapter's `SandboxProviderPort` implementation.
 *
 * Purpose:
 * Turns a `BootOptions` request into a real `@e2b/code-interpreter` `Sandbox` and wraps it into
 * a `SandboxSession` via `wrap-e2b-sandbox.ts`. This is the only file in `./e2b` that imports
 * the SDK itself — everything else depends on the narrow `E2bSandboxHandle` port, which is why
 * only live SDK integration needs a real API key or network access. The dedicated
 * `__tests__/provider.test.ts` exercises provider translation and failures with a mocked SDK.
 *
 * Architectural role:
 * The adapter's public entry point. `@e2b/code-interpreter` is an optional peer dependency of
 * this package (see package.json); importing this module is what actually requires it to be
 * installed. `./core` never imports from here.
 */
import { Sandbox } from '@e2b/code-interpreter';

import { SandboxOperationError } from '../core/errors.js';
import type { BootOptions, SandboxProviderPort, SandboxSession } from '../core/ports.js';
import { categorizeE2bError } from './categorize-e2b-error.js';
import type { E2bCommandHandle, E2bCommandResult, E2bRunOptions, E2bSandboxHandle } from './e2b-sandbox-handle.js';
import { wrapE2bSandbox } from './wrap-e2b-sandbox.js';

const DEFAULT_PROJECT_ROOT = '/home/user/app';
const DEFAULT_PREVIEW_PORT = 5173;
const DEFAULT_PREVIEW_CHECK_TIMEOUT_MS = 3_000;

export interface E2bProviderConfig {
  /** E2B API key. Omit to use the SDK's own `E2B_API_KEY` environment variable fallback — this
   *  adapter does not duplicate that lookup. */
  readonly apiKey?: string;
  /** Sandbox lifetime in milliseconds. Omit to use the SDK's own default (5 minutes). */
  readonly timeoutMs?: number;
  /** Absolute path inside the sandbox used as the project root.
   *  @default '/home/user/app' */
  readonly projectRoot?: string;
  /** Port `getPreview` asks E2B to forward — the port the caller's dev server binds to.
   *  @default 5173 */
  readonly previewPort?: number;
  /** How long `getPreview` waits for a single response before deciding nothing is listening.
   *  @default 3000 */
  readonly previewCheckTimeoutMs?: number;
}

/**
 * Adapts a real `Sandbox` into the object-argument `E2bSandboxHandle` port.
 * SDK positional arguments are translated only at this boundary. `files` is wrapped with one explicit function per member instead, because
 * TypeScript's assignability check between E2B's overloaded `write` (a single-file form plus a
 * batch form) and this interface's batch-only signature doesn't reliably resolve to the
 * matching overload — seen directly as a real, reproducible compile error, not a
 * theoretical concern — so the real object is never passed through as-is for that one member.
 * Calling `sandbox.files.write(files)` here, with a concrete array argument, invokes real
 * per-call overload resolution correctly; it's only the *object-to-interface* structural check
 * that gets confused.
 *
 * Exported (not part of the package's public `./e2b` barrel) so `__tests__/to-e2b-handle.test.ts`
 * can exercise the translation directly against a fake `Sandbox`-shaped object, rather than only
 * indirectly through `boot`'s mocked-out `Sandbox.create` call.
 */
export function toE2bHandle({ sandbox }: { sandbox: Sandbox }): E2bSandboxHandle {
  function run(requiredArgs: { command: string }, optionalArgs?: Omit<E2bRunOptions, 'background'>): Promise<E2bCommandResult>;
  function run(requiredArgs: { command: string; background: true }, optionalArgs?: Omit<E2bRunOptions, 'background'>): Promise<E2bCommandHandle>;
  // Return the port union explicitly so overload compatibility does not require SDK-only members.
  function run(requiredArgs: { command: string; background?: true }, optionalArgs: Omit<E2bRunOptions, 'background'> = {}): Promise<E2bCommandResult | E2bCommandHandle> {
    const { onStdout, onStderr, ...settings } = optionalArgs;
    const sdkOptions = {
      ...settings,
      ...(onStdout === undefined ? {} : { onStdout: (data: string) => onStdout({ data }) }),
      ...(onStderr === undefined ? {} : { onStderr: (data: string) => onStderr({ data }) }),
    };
    return requiredArgs.background === true
      ? sandbox.commands.run(requiredArgs.command, { ...sdkOptions, background: true })
      : sandbox.commands.run(requiredArgs.command, sdkOptions);
  }
  return {
    commands: { run },
    files: {
      write: ({ files }) => sandbox.files.write([...files]),
      read: ({ path, format }) => sandbox.files.read(path, { format }),
      list: ({ path }, opts) => sandbox.files.list(path, opts),
      watchDir: ({ path, onEvent }, opts) => sandbox.files.watchDir(path, onEvent, opts),
    },
    getHost: ({ port }) => sandbox.getHost(port),
    kill: () => sandbox.kill(),
  };
}

export function createE2bSandboxProvider(_requiredArgs: Record<string, never>, config: E2bProviderConfig & {
  createSandbox?: (requiredArgs: { options: { apiKey?: string; timeoutMs?: number; template?: string } }) => Promise<Sandbox>;
  fetchImpl?: typeof fetch;
} = {}): SandboxProviderPort {
  return {
    async boot(_requiredArgs: Record<string, never>, options?: BootOptions): Promise<SandboxSession> {
      const createOptions = {
        ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
        ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
        ...(options?.template !== undefined ? { template: options.template } : {}),
      };
      let sandbox: Sandbox;
      try {
        sandbox = config.createSandbox
          ? await config.createSandbox({ options: createOptions })
          : await Sandbox.create(createOptions);
      } catch (error) {
        throw new SandboxOperationError({ category: categorizeE2bError({ error }), message: 'Failed to create the sandbox' }, { cause: error });
      }

      return wrapE2bSandbox({ handle: toE2bHandle({ sandbox }), config: {
        projectRoot: config.projectRoot ?? DEFAULT_PROJECT_ROOT,
        previewPort: config.previewPort ?? DEFAULT_PREVIEW_PORT,
        previewCheckTimeoutMs: config.previewCheckTimeoutMs ?? DEFAULT_PREVIEW_CHECK_TIMEOUT_MS,
      } }, config.fetchImpl === undefined ? {} : { fetchImpl: config.fetchImpl });
    },
  };
}
