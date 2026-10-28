import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { claudeAgentDef, getAgentDef, type AgentLaunchResolution, type RuntimeBuildOptions, type RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createAgentExecutor } from '../index.js';
import { fixtureLaunchModel } from './model-discovery-fixture.js';

// Owner 2026-10-27: an owner-picked folder outside the site is readable, never natively writable.
describe('executor read-only extra directories', () => {
  it.each(['claude', 'codex', 'site-ancestor'] as const)('%s', async scenario => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'executor-read-only-')));
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const site = join(base, 'sites', 'site'); mkdirSync(site, { recursive: true });
      const picked = join(base, 'Picked Folder'); mkdirSync(picked);
      const executable = join(base, 'claude'); writeFileSync(executable, 'fixture, never executed');
      const actualDef = scenario === 'codex' ? getAgentDef({ id: 'codex' })! : claudeAgentDef;
      let buildOptions: RuntimeBuildOptions | undefined;
      let extraDirs: readonly string[] | undefined;
      const def: RuntimeAgentDef = { ...actualDef, buildArgs: (required, optional) => {
        buildOptions = optional?.options; extraDirs = optional?.extraAllowedDirs;
        return actualDef.buildArgs(required, optional);
      } };
      const argsSeen: string[][] = [];
      const spawnChild = vi.fn((_command: string, args: readonly string[]) => { argsSeen.push([...args]); throw new Error('stop after policy capture'); });
      const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
      const executor = createAgentExecutor({ lifecycle }, {
        hostEnv: { PATH: '/bin', HOME: base }, getAgentDef: () => def, resolveModelForLaunch: fixtureLaunchModel,
        resolveAgentLaunch: () => ({ selectedPath: executable, pathResolvedPath: executable, configuredOverridePath: null,
          launchPath: executable, launchKind: 'selected', childPathPrepend: [], diagnostic: null }) as AgentLaunchResolution,
        applyAgentLaunchEnv: ({ env }) => env, ensureAgentCapabilities: async () => {},
        assertClaudeFilesystemSupport: vi.fn(async () => scenario !== 'codex'), spawn: spawnChild as unknown as typeof spawn,
      });
      const { run } = await lifecycle.start({ contextRef: 'read-only-test' });
      const result = executor.run({ runId: run.id, agentId: def.id, cwd: site, prompt: 'hello' }, {
        filesystemRoot: site, nativeToolAccess: true, permissionMode: 'bypass', cliParity: true,
        readOnlyExtraDirs: [scenario === 'site-ancestor' ? join(base, 'sites') : picked],
      });
      if (scenario === 'site-ancestor') {
        await expect(result).rejects.toMatchObject({ code: 'FILESYSTEM_POLICY_INVALID' });
        expect(spawnChild).not.toHaveBeenCalled();
        return;
      }
      await expect(result).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
      // The picked folder is never a writable --add-dir for any CLI.
      expect(argsSeen[0]).not.toContain(picked);
      expect(extraDirs ?? []).not.toContain(picked);
      if (scenario === 'codex') {
        expect(buildOptions?.filesystemReadOnlyDirs).toBeUndefined();
        return;
      }
      expect(buildOptions?.filesystemReadOnlyDirs).toEqual([picked]);
      const settings = JSON.parse(argsSeen[0]![argsSeen[0]!.indexOf('--settings') + 1]!);
      expect(settings.permissions.additionalDirectories).toEqual([picked]);
      expect(settings.permissions.deny).toContain(`Edit(/${picked}/**)`);
      expect(settings.sandbox.filesystem.denyWrite).toEqual([picked]);
      expect(settings.sandbox.filesystem.allowWrite).not.toContain(picked);
    } finally { warnings.mockRestore(); rmSync(base, { recursive: true, force: true }); }
  });
});
