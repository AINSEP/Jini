/**
 * @module invocation
 *
 * Short, read-only metadata probes (model-list / version / help /
 * auth-status) for an agent CLI. Ported from OD's
 * `apps/daemon/src/runtimes/invocation.ts`. Command planning is core's pure
 * `planCommandInvocation`: `@jini-ai/platform`'s `createCommandInvocation`
 * (the function OD shipped from its workspace package, verbatim-lifted into
 * platform, see its `archived provenance ledger`) is only that planner plus the
 * process's own platform and `ComSpec`, so this module passes those two values
 * explicitly through `ambientCommandShell` instead of importing platform.
 */
import { execFile } from 'node:child_process';
import { scheduleProbeProcess } from './probe-scheduler.js';
import os from 'node:os';
import { promisify } from 'node:util';
import { planCommandInvocation, type RuntimePlatform } from '@jini-ai/core/contracts/runtime';
import type { RuntimeExecOptions } from './types.js';

const execFileP = promisify(execFile);
type ProbeExecPort = (input: { command: string; args: string[]; options: RuntimeExecOptions & { windowsVerbatimArguments?: boolean | undefined } }, optional: Record<string, never>) => ReturnType<typeof execFileP>;

/** The platform and fallback `ComSpec` a command plan needs; ambient values, injectable so tests never stub globals. */
export interface AmbientCommandShell { readonly platform: RuntimePlatform; readonly fallbackComSpec: string | undefined }

/**
 * Read the process's own platform and `ComSpec` (every call, never hoisted). When a host-built `env` carries no
 * `ComSpec`, Windows falls back to the process's own; dropping this would silently turn the cmd-shim into a bare `cmd.exe`.
 */
export function ambientCommandShell({ platform = process.platform, ambientEnv = process.env }: { platform?: RuntimePlatform; ambientEnv?: Readonly<Record<string, string | undefined>> } = {}): AmbientCommandShell {
  return { platform, fallbackComSpec: ambientEnv.ComSpec };
}

// Agent probes (model-list / version / help / auth-status) are short
// read-only metadata calls that never need the caller's project files.
// Default them to a neutral working directory instead of inheriting the
// host process cwd.
//
// This matters because some agent CLIs are bun-based and run a
// `bun install` on startup in their cwd to set up local plugins. When the
// host process is launched from a pnpm workspace (e.g. a dev checkout),
// inheriting that cwd lets a probe drop a workspace `bun.lock` +
// `node_modules/.bun` over the repo, wiping its pnpm store and breaking a
// running dev server. A probe writing a stray lockfile under the OS temp
// dir is harmless. Actual agent runs spawn elsewhere with an explicit
// project cwd and are unaffected.
export function execAgentFile({ command, args }: { command: string; args: string[] }, { options = {}, execute = (input) => execFileP(input.command, input.args, input.options), commandShell = ambientCommandShell() }: { options?: RuntimeExecOptions; execute?: ProbeExecPort; commandShell?: AmbientCommandShell } = {}
) {
  const invocation = planCommandInvocation(
    // The planner reads only `env.ComSpec`; with no env passed the old default (the process env) and the
    // ambient fallback are the same value, so an empty env here keeps that behaviour without a second env read.
    { command, platform: commandShell.platform, env: options.env ?? {} },
    { args, fallbackComSpec: commandShell.fallbackComSpec },
  );
  return scheduleProbeProcess({ work: async () => {
    const pending = execute({ command: invocation.command, args: invocation.args, options: {
      killSignal: 'SIGKILL', ...options, cwd: options.cwd ?? os.tmpdir(),
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    } }, {});
    try { return await pending; }
    finally {
      // AbortError can precede close. Hold the shared slot until the child actually exits.
      const child = pending.child;
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        await new Promise<void>(resolve => { child.once('close', () => resolve()); });
      }
    }
  } }, { priority: args.includes('--version') ? 'version' : 'metadata', signal: options.signal });
}
