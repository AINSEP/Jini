import { mkdtempSync, mkdirSync, realpathSync, existsSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChildProcess, spawn } from 'node:child_process';
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
      let runtimeTempMode: number | undefined;
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
        if (def.id === 'claude' && process.platform !== 'win32') runtimeTempMode = statSync(options.env!.CLAUDE_CODE_TMPDIR!).mode & 0o777;
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
        const runTempBase = capturedEnv?.CLAUDE_CODE_TMPDIR;
        if (def.id === 'claude' && process.platform !== 'win32') {
          expect(runTempBase).toMatch(/^\/tmp\/jini-[A-Za-z0-9]{6}$/);
          expect(runtimeTempMode).toBe(0o700);
          expect(Buffer.byteLength(join(runTempBase!, `claude-${process.getuid?.()}`))).toBeLessThanOrEqual(44);
          expect(existsSync(runTempBase!)).toBe(false);
        }
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
          const runtimeTemp = join(runTempBase ?? '', suffix);
          const runtimePaths = process.platform === 'win32' ? [] : process.platform === 'darwin' ? [runtimeTemp, `/private${runtimeTemp}`] : [runtimeTemp];
          expect(settings.sandbox.filesystem.allowWrite).toEqual([realpathSync(site), tempDir, ...runtimePaths]);
          expect(settings.sandbox.filesystem.allowRead).toEqual(expect.arrayContaining(runtimePaths));
          expect(settings.sandbox.filesystem.denyRead).toEqual(expect.arrayContaining(['/tmp', '/private/tmp', '/shared/login-temp', '/shared/tmp', '/shared/temp']));
          for (const denied of ['/tmp', '/private/tmp', `/tmp/${suffix}`, `/private/tmp/${suffix}`, '/shared/login-temp', base, image,
            ...(runtimeTempBase ? [join(runtimeTempBase, suffix)] : [])]) {
            expect(settings.sandbox.filesystem.allowRead).not.toContain(denied);
            expect(settings.sandbox.filesystem.allowWrite).not.toContain(denied);
          }
          expect(buildOptions?.filesystemRuntimeTempBase).toBe(process.platform === 'win32' ? undefined : runTempBase);
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

  it.skipIf(process.platform === 'win32').each([
    { ending: 'exit', code: 0, signal: null, state: 'succeeded' },
    { ending: 'crash', code: null, signal: 'SIGKILL', state: 'failed' },
    { ending: 'abort', code: null, signal: 'SIGTERM', state: 'cancelled' },
  ] as const)('isolates overlapping Claude runs and cleans scratch on $ending', async ({ ending, code, signal, state }) => {
    const h = scratchHarness({});
    try {
      const first = await h.start({});
      const second = await h.start({});
      const [firstBase, secondBase] = h.environments.map(env => env.CLAUDE_CODE_TMPDIR!);
      expect(firstBase).toMatch(/^\/tmp\/jini-[A-Za-z0-9]{6}$/);
      expect(secondBase).toMatch(/^\/tmp\/jini-[A-Za-z0-9]{6}$/);
      expect(firstBase).not.toBe(secondBase);
      expect(statSync(firstBase!).mode & 0o777).toBe(0o700);
      expect(statSync(secondBase!).mode & 0o777).toBe(0o700);
      for (const [index, otherBase] of [[0, secondBase], [1, firstBase]] as const) {
        for (const deniedBase of ['/tmp', '/private/tmp', '/tmp/operator-session', '/tmp/caller-session', otherBase]) {
          const denied = join(deniedBase!, `claude-${process.getuid?.()}`);
          expect(h.policies[index]!.allowRead).not.toContain(denied);
          expect(h.policies[index]!.allowWrite).not.toContain(denied);
          expect(h.policies[index]!.allowRead).not.toContain(`/private${denied}`);
          expect(h.policies[index]!.allowWrite).not.toContain(`/private${denied}`);
        }
      }
      if (ending === 'abort') await h.lifecycle.cancel({ runId: first.id });
      else {
        // A clean exit needs real assistant output, or the executor reports an empty run as failed.
        if (ending === 'exit') await h.reply({ index: 0 });
        h.children[0]!.emit('close', code, signal);
      }
      expect((await h.lifecycle.waitForTerminal({ runId: first.id })).state).toBe(state);
      expect(existsSync(firstBase!)).toBe(false);
      expect(existsSync(secondBase!)).toBe(true);
      if (ending === 'abort') expect(h.stopProcesses).toHaveBeenCalledOnce();
      h.children[1]!.emit('close', 0, null);
      await h.lifecycle.waitForTerminal({ runId: second.id });
      for (const env of h.environments) {
        expect(existsSync(env.CLAUDE_CODE_TMPDIR!)).toBe(false);
        expect(existsSync(env.TMPDIR!)).toBe(false);
      }
    } finally { h.cleanup({}); }
  });

  it.skipIf(process.platform === 'win32')('cleans an asynchronous spawn failure without removing another run\'s scratch', async () => {
    const h = scratchHarness({ failSecondSpawn: true });
    try {
      const first = await h.start({});
      await expect(h.start({})).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
      expect(existsSync(h.environments[1]!.CLAUDE_CODE_TMPDIR!)).toBe(false);
      expect(existsSync(h.environments[1]!.TMPDIR!)).toBe(false);
      expect(existsSync(h.environments[0]!.CLAUDE_CODE_TMPDIR!)).toBe(true);
      h.children[0]!.emit('close', 0, null);
      await h.lifecycle.waitForTerminal({ runId: first.id });
      expect(existsSync(h.environments[0]!.CLAUDE_CODE_TMPDIR!)).toBe(false);
    } finally { h.cleanup({}); }
  });
});

/** Real private directories and policy; all subprocess and process-control effects use DI fakes. */
function scratchHarness({ failSecondSpawn = false }: { failSecondSpawn?: boolean }, _options = {}) {
  const base = mkdtempSync(join(tmpdir(), 'executor-scratch-'));
  const site = join(base, 'site'); mkdirSync(site);
  const executable = join(base, 'claude'); writeFileSync(executable, 'fixture, never executed');
  const children: ChildProcess[] = [];
  const environments: NodeJS.ProcessEnv[] = [];
  const policies: { allowRead: string[]; allowWrite: string[] }[] = [];
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const stopProcesses = vi.fn(async () => {
    children[0]!.emit('close', null, 'SIGTERM');
    return { alreadyStopped: false, forcedPids: [], matchedPids: [4242], remainingPids: [], stoppedPids: [4242] };
  });
  const executor = createAgentExecutor({ lifecycle }, {
    hostEnv: { PATH: '/bin', HOME: base, CLAUDE_CODE_TMPDIR: '/tmp/operator-session' },
    getAgentDef: () => claudeAgentDef, resolveModelForLaunch: fixtureLaunchModel,
    resolveAgentLaunch: () => ({ selectedPath: executable, pathResolvedPath: executable, configuredOverridePath: null,
      launchPath: executable, launchKind: 'selected', childPathPrepend: [], diagnostic: null }) as AgentLaunchResolution,
    applyAgentLaunchEnv: ({ env }) => env, ensureAgentCapabilities: async () => {},
    assertClaudeFilesystemSupport: async () => true,
    listProcessSnapshots: async () => [], collectProcessTreePids: () => [4242], stopProcesses,
    spawn: ((_command: string, args: readonly string[], options: { env: NodeJS.ProcessEnv }) => {
      const child = Object.assign(new EventEmitter(), { pid: 4242 + children.length, killed: false,
        stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(() => true) }) as unknown as ChildProcess;
      children.push(child); environments.push(options.env);
      policies.push(JSON.parse(args[args.indexOf('--settings') + 1]!).sandbox.filesystem);
      queueMicrotask(() => {
        if (failSecondSpawn && children.length === 2) child.emit('error', new Error('fixture spawn failure'));
        else child.emit('spawn');
      });
      return child;
    }) as unknown as typeof spawn,
  });
  return { children, environments, policies, lifecycle, stopProcesses,
    reply: async ({ index }: { index: number }, _options = {}) => {
      (children[index]!.stdout as PassThrough).write(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } })}\n`);
      await new Promise(resolve => setImmediate(resolve));
    },
    start: async (_input = {}, _options = {}) => {
      const { run } = await lifecycle.start({ contextRef: 'scratch-isolation' });
      await executor.run({ runId: run.id, agentId: 'claude', cwd: site, prompt: 'hello' }, {
        filesystemRoot: site, nativeToolAccess: true, permissionMode: 'bypass', cliParity: true,
        env: { CLAUDE_CODE_TMPDIR: '/tmp/caller-session' },
      });
      return run;
    },
    cleanup: (_input = {}, _options = {}) => {
      for (const env of environments) if (env.CLAUDE_CODE_TMPDIR?.startsWith('/tmp/jini-')) rmSync(env.CLAUDE_CODE_TMPDIR, { recursive: true, force: true });
      rmSync(base, { recursive: true, force: true });
    },
  };
}
