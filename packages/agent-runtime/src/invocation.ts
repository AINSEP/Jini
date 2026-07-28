/**
 * @module invocation
 *
 * Short, read-only metadata probes (model-list / version / help /
 * auth-status) for an agent CLI. Ported from OD's
 * `apps/daemon/src/runtimes/core/invocation.ts` with one dependency swap:
 * `createCommandInvocation` now comes from `@injini/platform` instead of the
 * OD workspace package it originally shipped from — the two are the same
 * function (platform was already verbatim-lifted into `@injini/platform`,
 * see its `source-map.md`).
 */
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { createCommandInvocation } from '@injini/platform';
import type { RuntimeExecOptions } from './types.js';

const execFileP = promisify(execFile);

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
export function execAgentFile(
  command: string,
  args: string[],
  options: RuntimeExecOptions = {},
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
  return execFileP(invocation.command, invocation.args, {
    ...options,
    cwd: options.cwd ?? os.tmpdir(),
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
}
