import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { bindRuntimeAgentDef, createAgentRuntimeState } from '../runtime-state.js';
import { getRememberedLiveModels, isKnownModel, rememberLiveModels, resolveModelForAgent } from '../models.js';
import { loadClaudeCodeModels, type ClaudeCodeModelIo } from '../claude-code-models.js';
import { ensureAgentCapabilities } from '../detection.js';
import { configureExecutableResolutionEnv, userToolchainBinDirs } from '../executables.js';
import { buildExecutableDiagnostic } from '../diagnostics.js';
import { getAgentDef } from '../registry.js';
import { getRuntimeModelDiscoveryDeps } from '../model-discovery-adapters.js';

// hwb #14: identical agent/scope/binary values belong to different host instances.
it('isolates remembered models, launch selection, and model-catalog caches', () => {
  const a = createAgentRuntimeState({}); const b = createAgentRuntimeState({});
  const def = { ...getAgentDef({ id: 'claude' })!, id: 'host-agent', fallbackModels: [] };
  rememberLiveModels({ agentId: def.id, models: [{ id: 'model-a', label: 'A' }] }, { state: a });
  rememberLiveModels({ agentId: def.id, models: [{ id: 'model-b', label: 'B' }] }, { state: b });
  expect(getRememberedLiveModels({ agentId: def.id }, { state: a })).toEqual([{ id: 'model-a', label: 'model-a' }]);
  expect(isKnownModel({ def, modelId: 'model-b' }, { state: a })).toBe(false);
  expect(isKnownModel({ def, modelId: 'model-b' }, { state: b })).toBe(true);
  expect(resolveModelForAgent({ def, resolved: null }, { env: {}, state: a })).toBe('model-a');
  const depsA = getRuntimeModelDiscoveryDeps({ state: a });
  expect(depsA).toBe(getRuntimeModelDiscoveryDeps({ state: a }));
  expect(depsA.cache).not.toBe(getRuntimeModelDiscoveryDeps({ state: b }).cache);
  a.clear({}, {});
  expect(isKnownModel({ def, modelId: 'model-a' }, { state: a })).toBe(false);
  expect(isKnownModel({ def, modelId: 'model-b' }, { state: b })).toBe(true);
});

it('coalesces capability probes per host and binds the resulting flags into real launch arguments', async () => {
  const a = createAgentRuntimeState({}); const b = createAgentRuntimeState({});
  const def = getAgentDef({ id: 'claude' })!;
  let calls = 0;
  const input = { def, launchPath: '/same/claude', env: {} };
  const probeA = async () => { calls++; return { partialMessages: true }; };
  await Promise.all([ensureAgentCapabilities(input, { state: a, probe: probeA }), ensureAgentCapabilities(input, { state: a, probe: probeA })]);
  await ensureAgentCapabilities(input, { state: b, probe: async () => ({ partialMessages: false }) });
  expect(calls).toBe(1);
  expect(bindRuntimeAgentDef({ def, state: a }).buildArgs({ prompt: 'hello', imagePaths: [] })).toContain('--include-partial-messages');
  expect(bindRuntimeAgentDef({ def, state: b }).buildArgs({ prompt: 'hello', imagePaths: [] })).not.toContain('--include-partial-messages');
});

it('does not share Claude picker results or I/O between hosts with the same binary and config', async () => {
  const a = createAgentRuntimeState({}); const b = createAgentRuntimeState({});
  let calls = 0;
  const io = (model: string): ClaudeCodeModelIo => ({ runInitialize: async () => { calls++; return null; }, readConfigFile: async () => JSON.stringify({ additionalModelOptionsCache: [{ value: model }] }) });
  const required = { bin: '/same/claude', env: { HOME: '/same/home' } };
  expect(await loadClaudeCodeModels(required, { state: a, io: io('model-a'), now: () => 1 })).toEqual([{ id: 'model-a', label: 'model-a' }]);
  expect(await loadClaudeCodeModels(required, { state: b, io: io('model-b'), now: () => 1 })).toEqual([{ id: 'model-b', label: 'model-b' }]);
  expect(await loadClaudeCodeModels(required, { state: a, io: io('wrong-cache'), now: () => 2 })).toEqual([{ id: 'model-a', label: 'model-a' }]);
  expect(calls).toBe(2);
});

it('keeps executable configuration and toolchain caches per host', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwb-toolchain-'));
  try {
    const a = createAgentRuntimeState({}); const b = createAgentRuntimeState({});
    configureExecutableResolutionEnv({ overrides: { agentHomeEnvVar: 'HOST_A_HOME' } }, { state: a });
    configureExecutableResolutionEnv({ overrides: { agentHomeEnvVar: 'HOST_B_HOME' } }, { state: b });
    const env = { HOST_A_HOME: join(dir, 'a'), HOST_B_HOME: join(dir, 'b') };
    const first = userToolchainBinDirs({}, { state: a, env });
    const second = userToolchainBinDirs({}, { state: b, env });
    expect(first).toContain(join(dir, 'a', '.local', 'bin'));
    expect(second).toContain(join(dir, 'b', '.local', 'bin'));
    expect(buildExecutableDiagnostic({ def: { id: 'missing', name: 'Missing', bin: 'missing' } }, { state: a, env }).searchedDirs).toContain(join(dir, 'a', '.local', 'bin'));
    expect(first).not.toContain(join(dir, 'b', '.local', 'bin'));
    expect(userToolchainBinDirs({}, { state: a, env })).toBe(first);
    expect(a.executable.toolchainDirs).not.toBe(b.executable.toolchainDirs);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
