/**
 * @module prompt-file
 *
 * Stages a composed prompt to a temp file for adapters that declare
 * `promptViaFile: true`. Ported from OD's
 * `apps/daemon/src/runtimes/prompt-file.ts` with one de-branding
 * change: the temp-dir prefix was `od-${def.id}-...`; now
 * `agent-runtime-${def.id}-...`.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RuntimeAgentDef } from './types.js';

export type PreparedPromptFile = {
  path: string;
  cleanup: () => Promise<void>;
};

export async function preparePromptFileForAgent(
  def: RuntimeAgentDef | null | undefined,
  prompt: string,
  label: string,
): Promise<PreparedPromptFile | null> {
  if (!def?.promptViaFile) return null;

  const safeLabel = label.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 80) || 'prompt';
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `agent-runtime-${def.id}-${safeLabel}-`));
  const filePath = path.join(dir, 'prompt.md');
  await fs.writeFile(filePath, prompt, { encoding: 'utf8', mode: 0o600 });

  return {
    path: filePath,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
