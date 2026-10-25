import { mkdtempSync, mkdirSync, realpathSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { claudeAgentDef, getAgentDef, type AgentLaunchResolution, type RuntimeBuildOptions, type RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createAgentExecutor } from '../index.js';
import { fixtureLaunchModel } from './model-discovery-fixture.js';

describe('executor filesystem policy (owner 2026-10-23)', () => {
  it.each(['outside-image', 'outside-directory', 'wrong-cwd', 'invalid-settings', 'unsupported-claude', 'codex', 'unknown-version', 'valid', 'configured-temp', 'long-configured-temp'] as const)('enforces %s through the real executor before spawn', async scenario => {
    const base = mkdtempSync(join(tmpdir(), 'executor-filesystem-'));
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const site = join(base, 'site'); mkdirSync(site);
      const executable = join(base, 'claude'); writeFileSync(executable, 'fixture, never executed');
      const runtimeTempBase = scenario === 'configured-temp' ? '/tmp/own-runtime'
        : scenario === 'long-configured-temp' ? '/tmp/a-runtime-base-that-is-too-long-for-unix-sockets' : undefined;
      const childEnv = { PATH: '/bin', HOME: base, TMPDIR: '/shared/login-temp', TMP: '/shared/tmp', TEMP: '/shared/temp' };
      const image = join(base, 'outside-image.png'); writeFileSync(image, 'OUTSIDE_CANARY');
      const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
      const verify = vi.fn(async () => scenario === 'codex' || scenario === 'unsupported-claude' ? false : scenario === 'unknown-version' ? undefined : true);
      const actualDef = scenario === 'codex' ? getAgentDef({ id: 'codex' })! : claudeAgentDef;
      let buildOptions: RuntimeBuildOptions | undefined;
      let tempDir: string | undefined;
      let tempExistedAtSpawn = false;
      let capturedEnv: NodeJS.ProcessEnv | undefined;
      const def: RuntimeAgentDef = { ...actualDef, buildArgs: (required, optional) => {
        buildOptions = optional?.options;
        return actualDef.buildArgs(required, optional);
      } };
      const argsSeen: string[][] = [];
      const spawnChild = vi.fn((_command: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
        argsSeen.push([...args]);
        capturedEnv = options.env;
        tempDir = options.env?.TMPDIR;
        tempExistedAtSpawn = Boolean(tempDir && existsSync(tempDir));
        throw new Error('stop after policy capture');
      });
      const executor = createAgentExecutor({ lifecycle }, {
        // The daemon's own CLAUDE_CODE_TMPDIR must neither reach the child nor widen its policy (SEC-001).
        hostEnv: { ...childEnv, CLAUDE_CODE_TMPDIR: '/ambient/claude-temp' },
        getAgentDef: () => def, resolveModelForLaunch: fixtureLaunchModel,
        resolveAgentLaunch: () => ({ selectedPath: executable, pathResolvedPath: executable, configuredOverridePath: null,
          launchPath: executable, launchKind: 'selected', childPathPrepend: [], diagnostic: null }) as AgentLaunchResolution,
        applyAgentLaunchEnv: ({ env }) => env, ensureAgentCapabilities: async () => {},
        assertClaudeFilesystemSupport: verify, spawn: spawnChild as unknown as typeof spawn,
      });
      const { run } = await lifecycle.start({ contextRef: 'filesystem-test' });
      const result = executor.run({ runId: run.id, agentId: def.id, cwd: scenario === 'wrong-cwd' ? base : site, prompt: 'hello' }, {
        filesystemRoot: site, nativeToolAccess: true, permissionMode: 'bypass', cliParity: true,
        ...(scenario === 'invalid-settings' ? { settings: 'not JSON' } : {}),
        ...(scenario === 'outside-image' ? { imagePaths: [image] } : {}),
        ...(scenario === 'outside-directory' ? { extraAllowedDirs: [base] } : {}),
        ...(runtimeTempBase ? { env: { ...childEnv, CLAUDE_CODE_TMPDIR: runtimeTempBase } } : {}),
      });
      if (['valid', 'unknown-version', 'unsupported-claude', 'codex', 'configured-temp', 'long-configured-temp'].includes(scenario)) {
        await expect(result).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
        expect(spawnChild).toHaveBeenCalledOnce();
        expect(tempDir?.startsWith(join(realpathSync(site), '.agent-runtime', 'tmp-'))).toBe(true);
        expect(tempExistedAtSpawn).toBe(true);
        expect(capturedEnv?.TMP).toBe(tempDir); expect(capturedEnv?.TEMP).toBe(tempDir);
        expect(capturedEnv?.CLAUDE_CODE_TMPDIR).toBe(runtimeTempBase);
        expect(existsSync(tempDir!)).toBe(false); // Startup failure cleans only this run's temp.
        if (scenario === 'codex' || scenario === 'unsupported-claude') {
          expect(buildOptions?.filesystemRoot).toBeUndefined();
          if (scenario === 'unsupported-claude') {
            expect(buildOptions?.settingSources).toEqual([]);
            expect(argsSeen[0]![argsSeen[0]!.indexOf('--setting-sources') + 1]).toBe('');
          }
          expect(buildOptions?.systemPromptOverlay).toContain('files and shell are not folder-limited for this agent');
          expect(warnings).toHaveBeenCalledWith('[agent-executor] files and shell are not folder-limited for this agent');
        } else {
          expect(argsSeen[0]).toContain('bypassPermissions');
          expect(argsSeen[0]).toContain('--strict-mcp-config');
          expect(argsSeen[0]).not.toContain('--add-dir');
          const settings = JSON.parse(argsSeen[0]![argsSeen[0]!.indexOf('--settings') + 1]!);
          expect(settings.permissions.blockReadsOutsideWorkingDirectories).toBe(true);
          // Assert the final --settings after both merges, not just the options handed to buildArgs.
          const suffix = `claude-${process.getuid?.()}`;
          const defaultRuntimeTemp = join(process.platform === 'darwin' ? '/tmp' : tempDir!, suffix);
          const selectedRuntimeTemp = join(runtimeTempBase ?? (process.platform === 'darwin' ? '/tmp' : tempDir!), suffix);
          const runtimeTemps = scenario === 'long-configured-temp' ? [selectedRuntimeTemp, defaultRuntimeTemp] : [selectedRuntimeTemp];
          const runtimePaths = process.platform === 'win32' ? [] : runtimeTemps.flatMap(path => process.platform === 'darwin' ? [path, `/private${path}`] : [path]);
          expect(settings.sandbox.filesystem.allowWrite).toEqual([realpathSync(site), tempDir, ...runtimePaths]);
          expect(settings.sandbox.filesystem.allowRead).toEqual(expect.arrayContaining(runtimePaths));
          expect(settings.sandbox.filesystem.denyRead).toEqual(expect.arrayContaining(['/tmp', '/private/tmp', '/shared/login-temp', '/shared/tmp', '/shared/temp']));
          for (const denied of ['/tmp', '/private/tmp', '/shared/login-temp', base, image]) {
            expect(settings.sandbox.filesystem.allowRead).not.toContain(denied);
            expect(settings.sandbox.filesystem.allowWrite).not.toContain(denied);
          }
          expect(buildOptions?.filesystemRuntimeTempBase).toBe(runtimeTempBase ?? '');
          expect(settings.sandbox.enabled).toBe(process.platform !== 'win32');
          expect(settings.sandbox.failIfUnavailable).toBe(process.platform !== 'win32');
          expect(settings.sandbox.allowUnsandboxedCommands).toBe(process.platform === 'win32');
          expect(settings.sandbox.filesystem.allowRead).not.toContain(tmpdir());
          expect(JSON.stringify(settings)).not.toContain('/ambient');
          if (scenario === 'unknown-version') expect(warnings).toHaveBeenCalledWith('[agent-executor] filesystem capability unknown; applying read block and sandbox settings');
        }
        expect(JSON.stringify(warnings.mock.calls)).not.toContain('OUTSIDE_CANARY');
        expect(JSON.stringify(argsSeen)).not.toContain('OUTSIDE_CANARY');
      } else {
        await expect(result).rejects.toMatchObject({ code: scenario === 'invalid-settings' ? 'FILESYSTEM_POLICY_UNSUPPORTED' : 'FILESYSTEM_POLICY_INVALID' });
        expect(spawnChild).not.toHaveBeenCalled();
        if (scenario !== 'invalid-settings') expect(verify).not.toHaveBeenCalled();
      }
      expect((await lifecycle.get({ runId: run.id }))?.state).toBe('failed');
    } finally { warnings.mockRestore(); rmSync(base, { recursive: true, force: true }); }
  });
});
