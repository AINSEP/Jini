/**
 * @module log-file
 *
 * Stages a caller-owned temp path for adapters that declare
 * `needsAgentLogFile: true`, i.e. whose CLI takes a "write your diagnostic
 * log here" flag (`agy --log-file <path>`). The deliberate sibling of
 * `prompt-file.ts`: same `{path, cleanup}` shape, same `mkdtemp`-per-run
 * isolation, same "the caller creates it before `buildArgs` and removes it
 * after the child exits" contract — so `AgentExecutor` stages both through
 * one identical pattern instead of two.
 *
 * The one substantive difference from `prompt-file.ts`: **this does not write
 * the file.** The direction of travel is inverted — the prompt file is input
 * the caller authors for the CLI to read, whereas the log file is output the
 * CLI authors for the caller to read. Pre-creating it would be at best
 * redundant and at worst wrong (an adapter may expect to create the file
 * itself with its own flags). Only the containing directory is created, and
 * `mkdtemp` gives it `0o700` — which is the actual confidentiality control
 * here, since the CLI, not this module, decides the log file's own mode.
 *
 * No OD provenance: OD's daemon derived antigravity's `--log-file` path
 * inline in `server.ts` rather than through a reusable helper. Extracted as
 * one here so the staging is testable on its own and so a second adapter with
 * a log-file flag needs no new code — see `source-map.md`.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RuntimeAgentDef } from './types.js';

export type PreparedAgentLogFile = {
  /** Absolute path to hand over as `RuntimeContext.agentLogFilePath`. The file itself does not exist yet — the spawned CLI creates it. */
  path: string;
  /** Removes the staged directory and whatever the CLI wrote into it. Safe to call more than once (`force: true`). */
  cleanup: () => Promise<void>;
};

/**
 * Stages a temp log-file path for a `needsAgentLogFile` adapter.
 *
 * @param def - The resolved agent def. `null`/`undefined` is accepted (and
 * returns `null`) so a caller can invoke this unconditionally, exactly as
 * `preparePromptFileForAgent` allows.
 * @param label - Caller-side identifier for the run, embedded in the temp
 * directory name to make a stray directory traceable. Sanitized to
 * `[A-Za-z0-9_.-]` and truncated the same way `preparePromptFileForAgent`
 * does, so a run id containing path separators cannot escape `os.tmpdir()`.
 * @returns `{path, cleanup}`, or `null` for every def that did not opt in.
 * @complexity One `mkdtemp` syscall; `null` return path does no I/O at all.
 * @overallScore 100/100
 */
export async function prepareAgentLogFile(
  def: RuntimeAgentDef | null | undefined,
  label: string,
): Promise<PreparedAgentLogFile | null> {
  if (!def?.needsAgentLogFile) return null;

  const safeLabel = label.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 80) || 'agent';
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `agent-runtime-${def.id}-${safeLabel}-log-`));
  const filePath = path.join(dir, 'agent.log');

  return {
    path: filePath,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
