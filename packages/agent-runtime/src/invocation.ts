/**
 * @module invocation
 *
 * Short, read-only metadata probes (model-list / version / help /
 * auth-status) for an agent CLI. Ported from OD's
 * `apps/daemon/src/runtimes/invocation.ts` with one dependency swap:
 * `createCommandInvocation` now comes from `@jini-ai/platform` instead of the
 * OD workspace package it originally shipped from — the two are the same
 * function (platform was already verbatim-lifted into `@jini-ai/platform`,
 * see its `archived provenance ledger`).
 */
import { execFile } from 'node:child_process';
import { scheduleProbeProcess } from './probe-scheduler.js';
import os from 'node:os';
import { promisify } from 'node:util';
import { createCommandInvocation } from '@jini-ai/platform/command';
import type { RuntimeExecOptions } from './types.js';

const execFileP = promisify(execFile);
type ProbeExecPort = (input: { command: string; args: string[]; options: RuntimeExecOptions & { windowsVerbatimArguments?: boolean | undefined } }, optional: Record<string, never>) => ReturnType<typeof execFileP>;

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
export function execAgentFile({ command, args }: { command: string; args: string[] }, { options = {}, execute = (input) => execFileP(input.command, input.args, input.options) }: { options?: RuntimeExecOptions; execute?: ProbeExecPort } = {}
) {
  const invocation = createCommandInvocation(
    options.env
      ? {
          command,
          args,
          env: options.env,
        }
      : {
          command,
          args,
        },
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
