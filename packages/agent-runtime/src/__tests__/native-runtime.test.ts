/** Host isolation and explicit policy tests use real runtime owners with injected ACP/probe effects. */
import { afterEach, expect, it } from 'vitest';
import { createNativeAgentRuntime } from '../native-runtime.js';
import { createAgentRuntimeState } from '../runtime-state.js';
import { AGENT_DEFS } from '../registry.js';
import { setAcpModelProbe, type AcpModelProbe } from '../acp-model-probe.js';
import { getRuntimeModelDiscoveryDeps } from '../model-discovery-adapters.js';
import type { ModelDiscoveryContext } from '../model-discovery-types.js';
import type { DetectedAgent } from '../types.js';

const context: ModelDiscoveryContext = { executable: '/fake/cli', cwd: '/workspace', env: { PATH: '/fake/bin' } };
const rows = (id: string) => [{ id, label: id }];
const arrayProbe = (id: string): AcpModelProbe => ({ detectModels: async () => rows(id) });
afterEach(() => setAcpModelProbe({ probe: null }));

it('binds every ACP definition to the host probe, unaffected by the legacy setter', async () => {
  const a = createNativeAgentRuntime({ env: {} }, { acpModelProbe: arrayProbe('host-a') });
  const b = createNativeAgentRuntime({ env: {} }, { acpModelProbe: arrayProbe('host-b') });
  setAcpModelProbe({ probe: arrayProbe('legacy') });
  // AMR lists models through Vela's own catalog command, not an ACP probe.
  const defs = AGENT_DEFS.filter(def => def.streamFormat === 'acp-json-rpc' && def.fetchModels && def.id !== 'amr');
  expect(defs.map(def => def.id)).toContain('kimi');
  for (const def of defs) {
    const required = { resolvedBin: '/fake/cli', env: {} };
    expect(await a.getAgentDef({ id: def.id })!.fetchModels!(required)).toEqual(rows('host-a'));
    expect(await b.getAgentDef({ id: def.id })!.fetchModels!(required)).toEqual(rows('host-b'));
    // The compatibility definition still delegates to its process-level wrapper.
    expect(await def.fetchModels!(required)).toEqual(rows('legacy'));
  }
  await Promise.all([a.dispose({}), b.dispose({})]);
});

it('threads the same transport through catalog discovery and preserves native default metadata', async () => {
  const requests: unknown[] = [];
  const metadataProbe: AcpModelProbe = {
    detectModels: async () => { throw new Error('metadata transport must be selected'); },
    detectMetadata: async (required, optional = {}) => {
      requests.push({ ...required, cwd: optional.cwd, env: optional.env, signal: optional.signal });
      return { models: rows('selected-model'), currentModelId: 'selected-model' };
    },
  };
  const a = createNativeAgentRuntime({ env: {} }, { acpModelProbe: metadataProbe });
  const b = createNativeAgentRuntime({ env: {} }, { acpModelProbe: arrayProbe('selected-model') });
  const signal = new AbortController().signal;
  const required = { context, args: ['acp'], signal };
  expect(await getRuntimeModelDiscoveryDeps({ state: a.state }).acp.probe(required)).toEqual({
    models: rows('selected-model'), source: 'rpc', coverage: 'account', defaultSelectionId: 'selected-model',
  });
  expect(await getRuntimeModelDiscoveryDeps({ state: b.state }).acp.probe(required)).toEqual({
    models: rows('selected-model'), source: 'rpc', coverage: 'account',
  });
  expect(requests).toEqual([{ bin: '/fake/cli', args: ['acp'], cwd: '/workspace', env: { PATH: '/fake/bin' }, signal }]);
  expect(getRuntimeModelDiscoveryDeps({ state: a.state }).cache).toBe(a.state.modelCatalog);
  await Promise.all([a.dispose({}), b.dispose({})]);
});

it('rebinds a supplied state transport without discarding its other discovery ports', async () => {
  const state = createAgentRuntimeState({});
  const previous = getRuntimeModelDiscoveryDeps({ state });
  const runtime = createNativeAgentRuntime({ env: {} }, { state, acpModelProbe: arrayProbe('replacement') });
  const deps = getRuntimeModelDiscoveryDeps({ state });
  expect(deps.process).toBe(previous.process);
  expect(await deps.acp.probe({ context, args: ['acp'], signal: new AbortController().signal })).toEqual({
    models: rows('replacement'), source: 'rpc', coverage: 'account',
  });
  await runtime.dispose({});
});

it('resolves env policy once and lets explicit values override it for each host', async () => {
  const env = { CODEX_DISABLE_PLUGINS: '1', PI_GRACEFUL_SHUTDOWN_MS: '91' };
  const baseline = createNativeAgentRuntime({ env });
  const treatment = createNativeAgentRuntime({ env }, { codexDisablePlugins: false, piGracefulShutdownMs: 0 });
  env.CODEX_DISABLE_PLUGINS = '0';
  const input = { prompt: 'question', imagePaths: [] };
  const args = baseline.getAgentDef({ id: 'codex' })!.buildArgs(input);
  expect(args.slice(args.indexOf('--disable'), args.indexOf('--disable') + 2)).toEqual(['--disable', 'plugins']);
  expect(treatment.getAgentDef({ id: 'codex' })!.buildArgs(input)).not.toContain('--disable');
  expect(baseline.piGracefulShutdownMs).toBe(91);
  expect(treatment.piGracefulShutdownMs).toBe(0);
  await Promise.all([baseline.dispose({}), treatment.dispose({})]);
});

it('shares detection within a host and drains an in-flight scan before clearing every owned cache', async () => {
  const a = createNativeAgentRuntime({ env: { PATH: '/missing', HOME: '/missing' } });
  const b = createNativeAgentRuntime({ env: { PATH: '/missing', HOME: '/missing' } });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  const probeAgent: NonNullable<Parameters<typeof a.detectAgents>[1]>['probeAgent'] = async ({ def }) => {
    calls++;
    if (def.id === 'kimi') { started(); await gate; }
    return { ...def, available: false, models: [], modelsSource: 'fallback' } as DetectedAgent;
  };
  const first = a.detectAgents({}, { probeAgent });
  const shared = a.detectAgents({}, { probeAgent });
  await ready;
  expect(calls).toBe(AGENT_DEFS.length);
  expect(b.state.detections.size).toBe(0);
  a.state.capabilities.set('kimi', { feature: true });
  a.state.capabilityProbes.set('pending-help', gate);
  a.state.modelCatalog.set('cached-catalog', { retryAt: 10 });
  a.state.liveModelCache.set('kimi', new Set(['cached']));
  a.state.liveModelOrder.set('kimi', ['cached']);
  a.state.claudeModels.set('scope', { expiresAt: 1, value: Promise.resolve(null) });
  b.state.capabilities.set('kimi', { feature: false });
  const disposal = a.dispose({});
  expect(a.state.detections.size).toBe(AGENT_DEFS.length);
  release();
  expect(await shared).toEqual(await first);
  await disposal;
  expect(a.dispose({})).toBe(disposal);
  expect([a.state.detections.size, a.state.capabilities.size, a.state.capabilityProbes.size,
    a.state.liveModelCache.size, a.state.liveModelOrder.size, a.state.claudeModels.size, a.state.modelCatalog.size]).toEqual([0, 0, 0, 0, 0, 0, 0]);
  expect(a.state.executable.toolchainDirs).toBeNull();
  expect(b.state.capabilities.get('kimi')).toEqual({ feature: false });
  await expect(a.detectAgents({})).rejects.toThrow('Agent runtime is disposed');
  await b.dispose({});
});

it('binds model probing and launch resolution to the host env, and refuses probing after disposal', async () => {
  const { mkdtemp, mkdir, writeFile, chmod, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { kimiAgentDef } = await import('../defs/kimi.js');
  const { aiderAgentDef } = await import('../defs/aider.js');
  const { offlineDiscoveryDeps } = await import('../defs/__tests__/discovery-fakes.js');
  const root = await mkdtemp(path.join(tmpdir(), 'native-runtime-'));
  try {
    await mkdir(path.join(root, 'bin'));
    await writeFile(path.join(root, 'bin', 'aider'), '#!/bin/sh\n');
    await chmod(path.join(root, 'bin', 'aider'), 0o755);
    const runtime = createNativeAgentRuntime({ env: { PATH: path.join(root, 'bin'), HOME: root } });
    const launch = runtime.resolveAgentLaunch({ def: aiderAgentDef });
    expect(launch.launchPath).toBe(path.join(root, 'bin', 'aider'));
    expect(launch.childPathPrepend).toEqual([path.join(root, 'bin')]);
    const probed = await runtime.probeAgentModels({ def: kimiAgentDef }, { context, deps: offlineDiscoveryDeps() });
    expect(probed.source).toBe('fallback');
    expect(probed.models.map(model => model.id)).toEqual(kimiAgentDef.fallbackModels.map(model => model.id).filter(id => id !== 'default'));
    expect(runtime.getAgentDef({ id: 'no-such-agent' })).toBeNull();
    await runtime.dispose({});
    await expect(runtime.probeAgentModels({ def: kimiAgentDef }, { context, deps: offlineDiscoveryDeps() })).rejects.toMatchObject({ name: 'InvalidStateError' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('disposal waits for an in-flight model-catalog refresh before clearing the state', async () => {
  const state = createAgentRuntimeState({});
  let release!: () => void;
  const { offlineSnapshot } = await import('../model-discovery.js');
  const pending = new Promise<ReturnType<typeof offlineSnapshot>>(resolve => { release = () => resolve(offlineSnapshot('fingerprint', 0, [])); });
  state.modelCatalog.set('in-flight', { pending });
  const runtime = createNativeAgentRuntime({ env: {} }, { state });
  let disposed = false;
  const disposal = runtime.dispose({}).then(() => { disposed = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(disposed).toBe(false);
  expect(state.modelCatalog.size).toBe(1);
  release();
  await disposal;
  expect(state.modelCatalog.size).toBe(0);
});
