import { promises as fs } from 'node:fs';
import type { AgentRuntimePort } from '../../ports/agent-runtime.js';
import type { MutableRunInput } from '../launch.js';

async function prepareClaudeRuntimeTemp({ input, spawnEnv, runtimeTemps }: { input: MutableRunInput; spawnEnv: NodeJS.ProcessEnv; runtimeTemps: string[] }): Promise<void> {
  // Read denies also block create/unlink, so Claude's cwd files cannot live under /tmp.
  // /var/tmp exists on macOS/Linux; its realpath plus /claude-<uid> must fit 44 bytes
  // or the policy refuses launch instead of letting Bash fall back to shared scratch.
  // mkdtemp creates a private 0700 directory; register cleanup before resolving aliases.
  const runtimeTemp = await fs.mkdtemp('/var/tmp/jini-');
  runtimeTemps.push(runtimeTemp);
  input.filesystemRuntimeTempBase = await fs.realpath(runtimeTemp);
  spawnEnv.CLAUDE_CODE_TMPDIR = input.filesystemRuntimeTempBase;
}

export const claudeFilesystemAdapter = {
  prepare({ input, spawnEnv, runtimeTemps }: { input: MutableRunInput; spawnEnv: NodeJS.ProcessEnv; runtimeTemps: string[] }): Promise<void> | void {
    if (process.platform === 'win32') return;
    return prepareClaudeRuntimeTemp({ input, spawnEnv, runtimeTemps });
  },
  unsupported({ input }: { input: MutableRunInput }): void {
    // Personal Claude hooks/permissions stay excluded even on an unconfined CLI fallback.
    input.settingSources = [];
  },
  supported({ input, launchPath, spawnEnv }: { input: MutableRunInput; launchPath: string; spawnEnv: NodeJS.ProcessEnv }, { filesystem }: { filesystem: Pick<AgentRuntimePort['filesystem'], 'runtimePaths' | 'settings'> }): void {
    input.filesystemRuntimeReadPaths = filesystem.runtimePaths({ launchPath });
    // Validates host settings here so a malformed value fails cleanly; buildArgs merges again (idempotent).
    input.settings = filesystem.settings({ options: input });
    // A login environment can otherwise force auto-memory back on despite the host setting.
    spawnEnv.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  },
};
