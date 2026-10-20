import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  calls: [] as { file: string; args: string[] }[],
  // Keyed by a JSON-stringified args array so a single mock can answer
  // differently for --version / --help / models / status probes against
  // the same resolved binary path.
  responses: new Map<string, { stdout?: string; stderr?: string; error?: Error & { code?: string | number } }>(),
}));

vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    args: string[],
    _options: unknown,
    cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    mockState.calls.push({ file: _file, args });
    const key = JSON.stringify(args);
    const response = mockState.responses.get(key);
    if (!response) {
      cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      return;
    }
    if (response.error) {
      cb(response.error);
      return;
    }
    cb(null, { stdout: response.stdout ?? '', stderr: response.stderr ?? '' });
  },
}));

import { detectAgents as nativeDetectAgents, detectAgentsStream as nativeDetectAgentsStream, probeAgentModels as nativeProbeAgentModels } from '../detection.js';
import { normalizeDiscoveredModels } from '../model-discovery.js';
import { MODEL_CATALOG_TTL_MS, MODEL_NEGATIVE_TTL_MS } from '../model-discovery.js';
import { createAgentRuntimeState } from '../runtime-state.js';
import type { ModelDiscoveryDeps } from '../model-discovery-types.js';
import { agentCapabilities } from '../capabilities.js';
import { getRememberedLiveModels, rememberLiveModels } from '../models.js';
import type { AcpModelProbe } from '../acp-model-probe.js';
import type { AmrProfileResolver } from '../amr-profile-resolver.js';
import { AGENT_DEFS } from '../registry.js';

// Model effects are injected independently of the legacy version/auth subprocess fixture.
let acpTestProbe: AcpModelProbe | null = null;
function setAcpModelProbe({ probe }: { probe: AcpModelProbe | null }) { acpTestProbe = probe; }
function modelDeps(): ModelDiscoveryDeps {
  return {
    process: { async run({ args }) {
      const result = mockState.responses.get(JSON.stringify(args));
      if (!result || result.error) throw result?.error || new Error('No fixture response');
      return { stdout: result.stdout || '', stderr: result.stderr || '' };
    } },
    fs: { async read() { return null; } }, credential: { async connection() { return null; } },
    http: { async list() { throw new Error('No fixture credentials'); } },
    acp: { async probe() { return { models: acpTestProbe ? await acpTestProbe.detectModels({ bin: 'fixture', args: [] }) : [], source: 'rpc', coverage: 'account' }; } },
    rpc: { async probe() { throw new Error('No fixture SDK'); } }, clock: { now: Date.now }, cache: new Map(),
  };
}
function detectAgents(required: Parameters<typeof nativeDetectAgents>[0], optional: Parameters<typeof nativeDetectAgents>[1] = {}) {
  return nativeDetectAgents(required, { modelDiscoveryDeps: modelDeps(), ...optional });
}
function detectAgentsStream(required: Parameters<typeof nativeDetectAgentsStream>[0], optional: Parameters<typeof nativeDetectAgentsStream>[1] = {}) {
  return nativeDetectAgentsStream(required, { modelDiscoveryDeps: modelDeps(), ...optional });
}
function probeAgentModels(required: Parameters<typeof nativeProbeAgentModels>[0], optional: Parameters<typeof nativeProbeAgentModels>[1] = {}) {
  return nativeProbeAgentModels(required, { deps: modelDeps(), ...optional });
}

function makeExecutable(filePath: string): void {
  writeFileSync(filePath, '#!/bin/sh\necho stub\n', 'utf8');
  chmodSync(filePath, 0o755);
}

describe('detectAgents / detectAgentsStream — full probe pipeline (via the real cursor-agent def)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-detection-test-'));
    mockState.responses.clear();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function scopedEnv(bin: string): Record<string, Record<string, string>> {
    return {
      // Scope every unrelated agent to a definitely-missing home so
      // detection genuinely reports them unavailable rather than
      // accidentally picking up a real CLI installed on this dev machine.
      'cursor-agent': { CURSOR_AGENT_BIN: bin },
    };
  }

  it('reports a fully "available" agent with version, capabilities, live models, and ok auth', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '1.2.3\n' });
    mockState.responses.set(JSON.stringify(['--help']), { stdout: 'Usage: cursor-agent [--trust] ...' });
    mockState.responses.set(JSON.stringify(['models']), { stdout: 'gpt-5 - GPT-5\nsonnet-4 - Sonnet 4\n' });
    mockState.responses.set(JSON.stringify(['status']), { stdout: 'authenticated' });

    const results = await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin) });
    const cursor = results.find((a) => a.id === 'cursor-agent')!;

    expect(cursor.available).toBe(true);
    expect(cursor.version).toBe('1.2.3');
    expect(cursor.path).toBe(bin);
    expect(cursor.modelsSource).toBe('live');
    expect(cursor.models.some((m) => m.id === 'gpt-5')).toBe(true);
    expect(cursor.authStatus).toBe('ok');
    expect(agentCapabilities.get('cursor-agent')).toEqual({ trust: true });
    // buildArgs/listModels/fetchModels closures must be stripped from the
    // response shape (stripFns).
    expect((cursor as unknown as { buildArgs?: unknown }).buildArgs).toBeUndefined();
    expect((cursor as unknown as { listModels?: unknown }).listModels).toBeUndefined();
  });

  // `stripFns` builds its result by spreading `...rest`, so any new
  // `RuntimeAgentDef` field is published into this API response *by default*
  // unless explicitly destructured out. antigravity is the only def declaring
  // `needsAgentLogFile`/`stdoutPolicy`, and `stdoutPolicy` carries a closure —
  // `JSON.stringify` would drop the function but keep its wrapper, publishing
  // a misleading `{"buffering":"until-close"}`.
  //
  // `runtimeLock` is asserted stripped too even though no registered def
  // currently declares one (antigravity's own model-selection lock was
  // retired once `agy` gained a real `--model` flag — see `defs/
  // antigravity.ts`'s own doc): this is `stripFns`' general contract for the
  // field, not evidence a real closure was exercised here, and it keeps this
  // test from silently losing coverage if a future def declares one again.
  it("strips antigravity's spawn-orchestration fields out of the registry projection", async () => {
    const results = await detectAgents({  }, { configuredEnvByAgent: scopedEnv(path.join(dir, 'nonexistent-cursor-agent')) });
    const antigravity = results.find((a) => a.id === 'antigravity')!;

    expect(antigravity).toBeDefined();
    expect((antigravity as unknown as { needsAgentLogFile?: unknown }).needsAgentLogFile).toBeUndefined();
    expect((antigravity as unknown as { stdoutPolicy?: unknown }).stdoutPolicy).toBeUndefined();
    expect((antigravity as unknown as { runtimeLock?: unknown }).runtimeLock).toBeUndefined();
    // …while the declarative metadata a picker actually needs survives.
    expect(antigravity.streamFormat).toBe('plain');
    expect(antigravity.supportsCustomModel).toBe(false);
    // And nothing that survived would misrepresent itself once serialized.
    expect(JSON.parse(JSON.stringify(antigravity))).not.toHaveProperty('stdoutPolicy');
  });

  it('falls back to fallbackModels when the models probe returns an unusable list', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '1.2.3\n' });
    mockState.responses.set(JSON.stringify(['--help']), { stdout: 'no trust flag here' });
    mockState.responses.set(JSON.stringify(['models']), { stdout: 'No models available for this account.' });
    mockState.responses.set(JSON.stringify(['status']), { stdout: 'authenticated' });

    const results = await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin) });
    const cursor = results.find((a) => a.id === 'cursor-agent')!;
    expect(cursor.modelsSource).toBe('fallback');
    expect(cursor.models.some((m) => m.id === 'auto')).toBe(true);
    expect(agentCapabilities.get('cursor-agent')).toEqual({ trust: false });
  });

  it('falls back to fallbackModels when the models probe itself rejects', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '1.2.3\n' });
    mockState.responses.set(JSON.stringify(['status']), { stdout: 'authenticated' });
    // No --help or models response registered -> both reject with ENOENT.
    const results = await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin) });
    const cursor = results.find((a) => a.id === 'cursor-agent')!;
    expect(cursor.modelsSource).toBe('fallback');
    // probeCapabilities swallows the failure into an empty caps map.
    expect(agentCapabilities.get('cursor-agent')).toEqual({});
  });

  it('surfaces a missing-auth diagnostic and authStatus when the auth probe reports not-authenticated', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '1.2.3\n' });
    mockState.responses.set(JSON.stringify(['--help']), { stdout: '' });
    mockState.responses.set(JSON.stringify(['models']), { stdout: 'No models available for this account.' });
    mockState.responses.set(JSON.stringify(['status']), { stdout: 'Error: not authenticated. Run cursor-agent login.' });

    const results = await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin) });
    const cursor = results.find((a) => a.id === 'cursor-agent')!;
    expect(cursor.authStatus).toBe('missing');
    expect(cursor.diagnostics?.[0]?.reason).toBe('auth-missing');
  });

  it('publishes the auth probe\'s guidance as authMessage', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '1.2.3\n' });
    mockState.responses.set(JSON.stringify(['status']), { stdout: 'Error: not authenticated. Run cursor-agent login.' });
    const results = await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin) });
    expect(results.find((a) => a.id === 'cursor-agent')?.authMessage).toContain('cursor-agent login');
  });

  it('omits authMessage when the agent is authenticated', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '1.2.3\n' });
    mockState.responses.set(JSON.stringify(['status']), { stdout: 'authenticated' });
    const cursor = (await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin) })).find((a) => a.id === 'cursor-agent')!;
    expect(cursor.authStatus).toBe('ok');
    expect('authMessage' in cursor).toBe(false);
  });

  it('discovers the full probe\'s models against the host-supplied model context', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '1.2.3\n' });
    mockState.responses.set(JSON.stringify(['models']), { stdout: 'gpt-5 - GPT-5\n' });
    const context = { executable: bin, cwd: dir, env: {}, model: 'gpt-5' };
    const results = await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin), modelContextByAgent: { 'cursor-agent': context }, state: createAgentRuntimeState({}) });
    expect(results.find((a) => a.id === 'cursor-agent')?.modelCatalog?.defaultSelectionId).toBe('gpt-5');
  });

  it('reports not-executable when the version probe rejects with EACCES', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), {
      error: Object.assign(new Error('EACCES'), { code: 'EACCES' }),
    });
    const results = await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin) });
    const cursor = results.find((a) => a.id === 'cursor-agent')!;
    expect(cursor.available).toBe(false);
    expect(cursor.diagnostics?.[0]?.reason).toBe('not-executable');
  });

  it('reports a broken shim when the version probe rejects with ENOENT', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), {
      error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    });
    const results = await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin) });
    const cursor = results.find((a) => a.id === 'cursor-agent')!;
    expect(cursor.available).toBe(false);
    expect(cursor.diagnostics?.[0]?.reason).toBe('shim-broken');
  });

  it('reports a broken shim when the version probe rejects with ENOTDIR', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), {
      error: Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' }),
    });
    const results = await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin) });
    const cursor = results.find((a) => a.id === 'cursor-agent')!;
    expect(cursor.available).toBe(false);
    expect(cursor.diagnostics?.[0]?.reason).toBe('shim-broken');
  });

  it('reports not-executable for a numeric exit code 126, and shim-broken for 127', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), {
      error: Object.assign(new Error('exit 126'), { code: 126 }),
    });
    const results126 = await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin) });
    expect(results126.find((a) => a.id === 'cursor-agent')!.diagnostics?.[0]?.reason).toBe('not-executable');

    mockState.responses.set(JSON.stringify(['--version']), {
      error: Object.assign(new Error('exit 127'), { code: 127 }),
    });
    const results127 = await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin), force: true });
    expect(results127.find((a) => a.id === 'cursor-agent')!.diagnostics?.[0]?.reason).toBe('shim-broken');
  });

  it('treats a generic non-zero-exit version-probe failure as "spawned but no version"', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), {
      error: Object.assign(new Error('some other failure'), { code: 1 }),
    });
    mockState.responses.set(JSON.stringify(['--help']), { stdout: '' });
    mockState.responses.set(JSON.stringify(['models']), { stdout: 'No models available for this account.' });
    mockState.responses.set(JSON.stringify(['status']), { stdout: 'authenticated' });
    const results = await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin) });
    const cursor = results.find((a) => a.id === 'cursor-agent')!;
    expect(cursor.available).toBe(true);
    expect(cursor.version).toBeNull();
  });

  it('reports unavailable with a configured-bin-invalid diagnostic when the override points at a missing file', async () => {
    const results = await detectAgents({  }, { configuredEnvByAgent: {
      'cursor-agent': { CURSOR_AGENT_BIN: path.join(dir, 'does-not-exist') },
    } });
    const cursor = results.find((a) => a.id === 'cursor-agent')!;
    expect(cursor.available).toBe(false);
    expect(cursor.diagnostics?.[0]?.reason).toBe('configured-bin-invalid');
  });

  it('reports unavailable with a not-on-path diagnostic when nothing is configured or resolvable at all', async () => {
    // No CURSOR_AGENT_BIN override this time — scope PATH + the
    // toolchain-bin-dir search to an isolated empty fake home so this
    // assertion doesn't depend on whether cursor-agent happens to be
    // installed for real on this dev machine.
    const originalPath = process.env.PATH;
    process.env.AGENT_RUNTIME_HOME = dir;
    process.env.PATH = dir;
    try {
      const results = await detectAgents({  }, { configuredEnvByAgent: {} });
      const cursor = results.find((a) => a.id === 'cursor-agent')!;
      expect(cursor.available).toBe(false);
      expect(cursor.diagnostics?.[0]?.reason).toBe('not-on-path');
    } finally {
      process.env.PATH = originalPath;
      delete process.env.AGENT_RUNTIME_HOME;
    }
  });

  it('remembers live models so a later isKnownModel/getRememberedLiveModels lookup can see them', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '1.2.3\n' });
    mockState.responses.set(JSON.stringify(['--help']), { stdout: '' });
    mockState.responses.set(JSON.stringify(['models']), { stdout: 'gpt-5 - GPT-5\n' });
    mockState.responses.set(JSON.stringify(['status']), { stdout: 'authenticated' });
    await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin) });
    expect(getRememberedLiveModels({ agentId: 'cursor-agent' }).some((m) => m.id === 'gpt-5')).toBe(true);
  });

  it('a def with a fetchModels function (devin, via ACP) surfaces live models from the injected AcpModelProbe', async () => {
    const bin = path.join(dir, 'devin');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '2.0.0\n' });
    const stub = { detectModels: async () => [{ id: 'adaptive', label: 'Adaptive' }] };
    setAcpModelProbe({ probe: stub });
    try {
      const results = await detectAgents({  }, { configuredEnvByAgent: { devin: { DEVIN_BIN: bin } } });
      const devin = results.find((a) => a.id === 'devin')!;
      expect(devin.available).toBe(true);
      expect(devin.modelsSource).toBe('live');
      expect(devin.models).toEqual([{ id: 'adaptive', label: 'Adaptive', identityKind: 'routing-mode' }]);
      expect(devin.defaultModelResolution?.status).toBe('unresolved');
    } finally {
      setAcpModelProbe({ probe: null });
    }
  });

  it('a def with a fetchModels function falls back when the probe returns an empty list', async () => {
    const bin = path.join(dir, 'devin');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '2.0.0\n' });
    setAcpModelProbe({ probe: { detectModels: async () => [] } });
    try {
      const results = await detectAgents({  }, { configuredEnvByAgent: { devin: { DEVIN_BIN: bin } } });
      const devin = results.find((a) => a.id === 'devin')!;
      expect(devin.modelsSource).toBe('fallback');
      expect(devin.models.some((m) => m.id === 'adaptive')).toBe(true);
    } finally {
      setAcpModelProbe({ probe: null });
    }
  });

  it('a def with a fetchModels function falls back when the probe throws', async () => {
    const bin = path.join(dir, 'devin');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '2.0.0\n' });
    setAcpModelProbe({ probe: {
      detectModels: async () => {
        throw new Error('boom');
      },
    } });
    try {
      const results = await detectAgents({  }, { configuredEnvByAgent: { devin: { DEVIN_BIN: bin } } });
      const devin = results.find((a) => a.id === 'devin')!;
      expect(devin.modelsSource).toBe('fallback');
    } finally {
      setAcpModelProbe({ probe: null });
    }
  });

  it('amr: unscoped remembered models are never relabelled as a live catalog on failure', async () => {
    const bin = path.join(dir, 'vela');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '0.9.0\n' });
    // `vela model list --format json` fails with a non-retriable message so
    // fetchVelaRemoteModelsWithRetry throws on the first attempt (no sleep).
    mockState.responses.set(JSON.stringify(['model', 'list', '--format', 'json']), {
      error: new Error('malformed response'),
    });
    const stubResolver: AmrProfileResolver = { resolveProfile: () => 'profile-a' };
    rememberLiveModels({ agentId: 'amr', models: [{ id: 'remembered-model', label: 'Remembered' }] }, { scope: 'profile-a' });
    const results = await detectAgents({  }, { configuredEnvByAgent: { amr: { VELA_BIN: bin } }, amrProfileResolver: stubResolver });
    const amr = results.find((a) => a.id === 'amr')!;
    expect(amr.modelsSource).toBe('fallback');
    // getRememberedLiveModels synthesizes label = id (see models.ts); it has no freshness.
    expect(amr.models).toEqual([]);
    expect(amr.modelCatalog?.freshness).toBe('offline-fallback');
  });

  it('amr: withRememberedAmrModels returns the (empty) fallback unchanged when nothing was remembered for that scope', async () => {
    const bin = path.join(dir, 'vela');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '0.9.0\n' });
    mockState.responses.set(JSON.stringify(['model', 'list', '--format', 'json']), {
      error: new Error('malformed response'),
    });
    const stubResolver: AmrProfileResolver = { resolveProfile: () => 'profile-never-remembered' };
    const results = await detectAgents({  }, { configuredEnvByAgent: { amr: { VELA_BIN: bin } }, amrProfileResolver: stubResolver });
    const amr = results.find((a) => a.id === 'amr')!;
    expect(amr.modelsSource).toBe('fallback');
    expect(amr.models).toEqual([]);
  });

  it('aider reports explicitly offline models when CLI-effective provider credentials are unavailable', async () => {
    const bin = path.join(dir, 'aider');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '0.60.0\n' });
    const results = await detectAgents({  }, { configuredEnvByAgent: { aider: { AIDER_BIN: bin } } });
    const aider = results.find((a) => a.id === 'aider')!;
    expect(aider.available).toBe(true);
    expect(aider.modelsSource).toBe('fallback');
    expect(aider.models.some((m) => m.id === 'sonnet')).toBe(true);
  });

  it('a failed AMR discovery does not consult a legacy remembered-model profile resolver', async () => {
    const bin = path.join(dir, 'vela');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '0.9.0\n' });
    // Previously a failed live fetch consulted the remembered-model resolver and its throw
    // could collapse detection. Scoped discovery owns recovery now; no remembered list
    // is eligible for promotion to live, so this failed probe never consults that resolver.
    mockState.responses.set(JSON.stringify(['model', 'list', '--format', 'json']), {
      error: new Error('malformed response'),
    });
    const throwingResolver: AmrProfileResolver = {
      resolveProfile: vi.fn(() => {
        throw new Error('resolver blew up');
      }),
    };
    const results = await detectAgents({  }, { configuredEnvByAgent: { amr: { VELA_BIN: bin } }, amrProfileResolver: throwingResolver });
    const amr = results.find((a) => a.id === 'amr')!;
    expect(amr.available).toBe(true);
    expect(amr.models).toEqual([]);
    expect(amr.modelCatalog?.freshness).toBe('offline-fallback');
    expect(throwingResolver.resolveProfile).not.toHaveBeenCalled();
  });

  it('amr: a successful live fetch short-circuits withRememberedAmrModels without consulting remembered state', async () => {
    const bin = path.join(dir, 'vela');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '0.9.0\n' });
    mockState.responses.set(JSON.stringify(['model', 'list', '--format', 'json']), {
      stdout: JSON.stringify({ source: 'remote', data: [{ id: 'live-model', object: 'model' }] }),
    });
    const results = await detectAgents({  }, { configuredEnvByAgent: { amr: { VELA_BIN: bin } } });
    const amr = results.find((a) => a.id === 'amr')!;
    expect(amr.modelsSource).toBe('live');
    expect(amr.models.some((m) => m.id === 'live-model')).toBe(true);
  });

  it('reuses a launch path\'s --help evidence across detection scopes and re-probes it on force', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '1.2.3\n' });
    mockState.responses.set(JSON.stringify(['--help']), { stdout: 'Usage: cursor-agent [--trust] ...' });
    const state = createAgentRuntimeState({});
    const helpCalls = () => mockState.calls.filter(call => call.file === bin && JSON.stringify(call.args) === '["--help"]').length;
    const before = helpCalls();
    const env = { PATH: '/missing', HOME: '/missing' };
    await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin), state, env });
    const second = await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin), state, env: { ...env, EXTRA: '1' } });
    expect(helpCalls()).toBe(before + 1);
    expect(state.capabilities.get('cursor-agent')).toEqual({ trust: true });
    expect(second.find(agent => agent.id === 'cursor-agent')?.available).toBe(true);
    await detectAgents({  }, { configuredEnvByAgent: scopedEnv(bin), state, env, force: true });
    expect(helpCalls()).toBe(before + 2);
  });

  it('detectAgentsStream yields every registered agent exactly once, in completion order', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '1.2.3\n' });
    mockState.responses.set(JSON.stringify(['--help']), { stdout: '' });
    mockState.responses.set(JSON.stringify(['models']), { stdout: 'No models available for this account.' });
    mockState.responses.set(JSON.stringify(['status']), { stdout: 'authenticated' });

    const seenIds: string[] = [];
    for await (const agent of detectAgentsStream({  }, { configuredEnvByAgent: scopedEnv(bin) })) {
      seenIds.push(agent.id);
    }
    expect(seenIds.length).toBeGreaterThan(20);
    expect(new Set(seenIds).size).toBe(seenIds.length);
    expect(seenIds).toContain('cursor-agent');
  });

});


/**
 * The end-to-end assertion for the Local-CLI picker's effort list: what `detectAgents()` publishes
 * is what the "Execution mode" tab renders, verbatim. Codex's static `reasoningOptions` stops at
 * `xhigh`, so before this wiring `max` and `ultra` were unreachable from the picker even for a model
 * whose own catalog entry declares them.
 */
describe('detectAgents — codex effort options come from the live catalog', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-codex-effort-test-'));
    mockState.responses.clear();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // Trimmed from a live `codex debug models` run (codex-cli 0.153.4).
  const LIVE_CATALOG = JSON.stringify({
    models: [
      {
        slug: 'gpt-6-astra',
        display_name: 'GPT-6 Astra',
        visibility: 'list',
        supported_reasoning_levels: [
          { effort: 'low' }, { effort: 'medium' }, { effort: 'high' },
          { effort: 'xhigh' }, { effort: 'max' }, { effort: 'ultra' },
        ],
      },
      { slug: 'codex-auto-review', visibility: 'hide', supported_reasoning_levels: [{ effort: 'max' }] },
    ],
  });

  function codexEnv(bin: string): Record<string, Record<string, string>> {
    return { codex: { CODEX_BIN: bin } };
  }

  async function detectCodex(catalogStdout: string) {
    const bin = path.join(dir, 'codex');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: 'codex-cli 0.153.4\n' });
    mockState.responses.set(JSON.stringify(['debug', 'models']), { stdout: catalogStdout });
    mockState.responses.set(JSON.stringify(['login', 'status']), { stdout: 'Logged in' });
    const results = await detectAgents({  }, { configuredEnvByAgent: codexEnv(bin) });
    return results.find((a) => a.id === 'codex')!;
  }

  it('publishes `max` and `ultra`, and drops the levels no catalog model supports', async () => {
    const codex = await detectCodex(LIVE_CATALOG);

    expect(codex.available).toBe(true);
    expect(codex.modelsSource).toBe('live');
    // The exact rendered list, not "contains max": asserting containment alone would also pass on a
    // list that still carried `none`/`minimal`, which no model in the catalog accepts.
    expect(codex.reasoningOptions?.map((r) => r.id)).toEqual([
      'default', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
    ]);
    // And the hidden entry contributed neither a model nor a level.
    expect(codex.models.map((m) => m.id)).toEqual(['gpt-6-astra']);
  });

  it('keeps the static effort list when the catalog is unusable, rather than emptying the picker', async () => {
    const codex = await detectCodex('not json at all');

    expect(codex.modelsSource).toBe('fallback');
    expect(codex.reasoningOptions?.map((r) => r.id)).toEqual([
      'default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh',
    ]);
  });

  it('strips the derive closure from the published shape', async () => {
    const codex = await detectCodex(LIVE_CATALOG);
    expect((codex as unknown as { deriveReasoningOptions?: unknown }).deriveReasoningOptions).toBeUndefined();
    expect(JSON.parse(JSON.stringify(codex))).not.toHaveProperty('deriveReasoningOptions');
  });
});

describe('cached detection catalog lifetimes', () => {
  it('recovers a Claude disk fallback after 30 seconds without repeating executable/version/help/auth probes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-disk-fallback-'));
    try {
      const bin = path.join(dir, 'claude');
      makeExecutable(bin);
      mockState.calls.length = 0;
      mockState.responses.clear();
      mockState.responses.set(JSON.stringify(['--version']), { stdout: '1.2.3' });
      mockState.responses.set(JSON.stringify(['-p', '--help']), { stdout: 'Usage: claude --add-dir' });
      mockState.responses.set(JSON.stringify(['auth', 'status']), { stdout: '{"loggedIn":true}' });
      let now = 0; let calls = 0;
      const deps = modelDeps();
      deps.clock.now = () => now;
      deps.fs.read = async file => file === path.join(dir, '.claude.json')
        ? '{"additionalModelOptionsCache":[{"value":"claude-cached"}]}' : null;
      deps.process.run = async ({ context }) => {
        if (context.executable !== bin) throw new Error('Unrelated CLI');
        calls++;
        if (calls === 1) throw new Error('Live listing offline');
        return { stdout: '{"type":"control_response","response":{"subtype":"success","response":{"models":[{"value":"claude-recovered"}]}}}', stderr: '' };
      };
      const options = { state: createAgentRuntimeState({}), env: { PATH: dir, HOME: dir },
        configuredEnvByAgent: { claude: { CLAUDE_BIN: bin } }, modelDiscoveryDeps: deps };
      const claude = (agents: Awaited<ReturnType<typeof nativeDetectAgents>>) => agents.find(agent => agent.id === 'claude')!;
      const first = claude(await nativeDetectAgents({}, options));
      expect(first.modelCatalog?.source).toBe('cli-cache');
      expect(first.modelCatalog?.freshness).toBe('stale');
      expect(first.models.map(model => model.id)).toEqual(['claude-cached']);
      now = MODEL_NEGATIVE_TTL_MS - 1;
      expect(claude(await nativeDetectAgents({}, options))).toEqual(first);
      expect(calls).toBe(1);
      now++;
      const [next, concurrent] = await Promise.all([nativeDetectAgents({}, options), nativeDetectAgents({}, options)]);
      expect(claude(next).models.map(model => model.id)).toEqual(['claude-recovered']);
      expect(claude(next).modelCatalog?.freshness).toBe('fresh');
      expect(claude(concurrent)).toEqual(claude(next));
      expect(calls).toBe(2);
      const executableCalls = mockState.calls.filter(call => call.file === bin);
      expect(executableCalls.filter(call => call.args[0] === '--version')).toHaveLength(1);
      expect(executableCalls.filter(call => call.args.join(' ') === '-p --help')).toHaveLength(1);
      expect(executableCalls.filter(call => call.args.join(' ') === 'auth status')).toHaveLength(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  for (const initiallyOffline of [true, false]) {
    it(`refreshes ${initiallyOffline ? 'offline' : 'fresh'} catalogs at expiry without repeating executable probes`, async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-catalog-expiry-'));
      try {
        const bin = path.join(dir, 'cursor-agent');
        makeExecutable(bin);
        mockState.calls.length = 0;
        mockState.responses.clear();
        mockState.responses.set(JSON.stringify(['--version']), { stdout: '1.2.3' });
        mockState.responses.set(JSON.stringify(['--help']), { stdout: 'Usage: cursor-agent --trust' });
        mockState.responses.set(JSON.stringify(['status']), { stdout: 'authenticated' });
        let now = 0; let calls = 0; let offline = initiallyOffline;
        const deps = modelDeps();
        deps.clock.now = () => now;
        deps.process.run = async ({ context }) => {
          if (context.executable !== bin) throw new Error('Unrelated CLI');
          calls++;
          if (offline) throw new Error('Offline');
          return { stdout: `gpt-catalog-${calls} - Catalog ${calls}\n`, stderr: '' };
        };
        const options = { state: createAgentRuntimeState({}), env: { PATH: dir, HOME: dir },
          configuredEnvByAgent: { 'cursor-agent': { CURSOR_AGENT_BIN: bin } }, modelDiscoveryDeps: deps };
        const cursor = (agents: Awaited<ReturnType<typeof nativeDetectAgents>>) => agents.find(agent => agent.id === 'cursor-agent')!;
        const first = cursor(await nativeDetectAgents({}, options));
        expect(first.modelCatalog?.freshness).toBe(initiallyOffline ? 'offline-fallback' : 'fresh');
        const ttl = initiallyOffline ? MODEL_NEGATIVE_TTL_MS : MODEL_CATALOG_TTL_MS;
        now = ttl - 1;
        expect(cursor(await nativeDetectAgents({}, options))).toEqual(first);
        expect(calls).toBe(1);
        offline = false;
        now++;
        const [next, concurrent] = await Promise.all([nativeDetectAgents({}, options), nativeDetectAgents({}, options)]);
        expect(cursor(next).models.map(model => model.id)).toEqual(['gpt-catalog-2']);
        expect(cursor(concurrent)).toEqual(cursor(next));
        expect(cursor(next).modelCatalog?.freshness).toBe('fresh');
        // The refresh reuses the detected version, so the catalog keeps its launch scope.
        expect(cursor(next).modelCatalog?.launchFingerprint).toBe(first.modelCatalog?.launchFingerprint);
        expect(calls).toBe(2);
        const executableCalls = mockState.calls.filter(call => call.file === bin);
        expect(executableCalls.filter(call => call.args[0] === '--version')).toHaveLength(1);
        expect(executableCalls.filter(call => call.args[0] === '--help')).toHaveLength(1);
        expect(executableCalls.filter(call => call.args[0] === 'status')).toHaveLength(1);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
});

describe('probeAgentModels — the model half of detection, for hosts with their own availability check', () => {
  let dir: string;
  const cursorDef = () => AGENT_DEFS.find((def) => def.id === 'cursor-agent')!;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-probe-models-test-'));
    mockState.responses.clear();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the live list (without a --version probe) and remembers it for model validation', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['models']), { stdout: 'gpt-probe-live - GPT Probe\n' });

    const result = await probeAgentModels({ def: cursorDef() }, { configuredEnv: { CURSOR_AGENT_BIN: bin } });

    expect(result.source).toBe('live');
    expect(result.models.some((m) => m.id === 'gpt-probe-live')).toBe(true);
    expect(getRememberedLiveModels({ agentId: 'cursor-agent' }).some((m) => m.id === 'gpt-probe-live')).toBe(true);
  });

  it('returns fallbackModels when the binary cannot be found', async () => {
    const result = await probeAgentModels({ def: cursorDef() }, { configuredEnv: { CURSOR_AGENT_BIN: path.join(dir, 'missing') , PATH: dir } });
    expect(result.models).toEqual(normalizeDiscoveredModels(cursorDef().fallbackModels));
    expect(result.source).toBe('fallback');
    expect(result.catalog?.freshness).toBe('offline-fallback');
    expect(result.defaultModelResolution?.status).toBe('unresolved');
  });

  it('returns fallbackModels when the model listing fails', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    const result = await probeAgentModels({ def: cursorDef() }, { configuredEnv: { CURSOR_AGENT_BIN: bin } });
    expect(result.models).toEqual(normalizeDiscoveredModels(cursorDef().fallbackModels));
    expect(result.source).toBe('fallback');
    expect(result.catalog?.freshness).toBe('offline-fallback');
    expect(result.defaultModelResolution?.status).toBe('unresolved');
  });
});

describe('probeAgentModels — option boundaries', () => {
  let dir: string;
  const cursorDef = () => AGENT_DEFS.find((def) => def.id === 'cursor-agent')!;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-probe-options-test-'));
    mockState.responses.clear();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function liveBin(): string {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['models']), { stdout: 'gpt-opt - GPT Opt\n' });
    return bin;
  }

  it('serves a repeat probe from the discovery cache and re-lists on force', async () => {
    const bin = liveBin(); const deps = modelDeps(); let runs = 0;
    const run = deps.process.run;
    deps.process.run = async (input) => { runs++; return run(input); };
    const listings = () => runs;
    await probeAgentModels({ def: cursorDef() }, { configuredEnv: { CURSOR_AGENT_BIN: bin }, deps });
    const before = listings();
    await probeAgentModels({ def: cursorDef() }, { configuredEnv: { CURSOR_AGENT_BIN: bin }, deps });
    expect(listings()).toBe(before);
    await probeAgentModels({ def: cursorDef() }, { configuredEnv: { CURSOR_AGENT_BIN: bin }, deps, force: true });
    expect(listings()).toBe(before + 1);
  });

  it('discovers against a host-supplied context instead of the launch path', async () => {
    const bin = liveBin();
    const context = { executable: '/host/cursor', cwd: '/host', env: {}, model: 'gpt-opt' };
    const result = await probeAgentModels({ def: cursorDef() }, { configuredEnv: { CURSOR_AGENT_BIN: bin }, context });
    expect(result.catalog?.defaultSelectionId).toBe('gpt-opt');
  });

  it('scopes the catalog fingerprint to the supplied version', async () => {
    const bin = liveBin();
    const one = await probeAgentModels({ def: cursorDef() }, { configuredEnv: { CURSOR_AGENT_BIN: bin }, version: '1' });
    const two = await probeAgentModels({ def: cursorDef() }, { configuredEnv: { CURSOR_AGENT_BIN: bin }, version: '2' });
    expect(one.catalog?.launchFingerprint).not.toBe(two.catalog?.launchFingerprint);
  });

  it('discovers through the state\'s runtime deps when none are injected', async () => {
    const bin = liveBin(); const state = createAgentRuntimeState({});
    const result = await nativeProbeAgentModels({ def: cursorDef() }, { configuredEnv: { CURSOR_AGENT_BIN: bin }, state, env: { PATH: '/missing', HOME: dir } });
    expect(result.catalog?.launchFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(state.modelCatalog.size).toBe(1);
  });

  it('reports a discovery failure as an unavailable executable (reported, not fixed)', async () => {
    // probeAgentModels' catch-all maps ANY throw — here the injected clock — to the
    // "Agent executable is unavailable." resolution, although the binary was found.
    const bin = liveBin();
    const deps = { ...modelDeps(), clock: { now: (): number => { throw new Error('clock unavailable'); } } };
    const result = await probeAgentModels({ def: cursorDef() }, { configuredEnv: { CURSOR_AGENT_BIN: bin }, deps });
    expect(result.source).toBe('fallback');
    expect(result.defaultModelResolution).toEqual({ status: 'unresolved', reason: 'Agent executable is unavailable.' });
  });
});

describe('detectAgents — fault isolation and option plumbing', () => {
  const env = { PATH: '/missing', HOME: '/missing' };

  it('reports only the agent whose probe throws as unavailable, without diagnostics', async () => {
    const state = createAgentRuntimeState({});
    const results = await nativeDetectAgents({}, { state, env, modelDiscoveryDeps: modelDeps(), probeAgent: async ({ def }) => {
      if (def.id === 'claude') throw new Error('probe exploded');
      return { ...def, available: true, models: [], modelsSource: 'live' };
    } });
    const claude = results.find(agent => agent.id === 'claude')!;
    expect(claude).toMatchObject({ available: false, modelsSource: 'fallback', defaultModelResolution: { status: 'unresolved', reason: 'Agent executable is unavailable.' } });
    expect(claude.diagnostics).toBeUndefined();
    expect(results.find(agent => agent.id === 'codex')?.available).toBe(true);
  });

  it('reports every agent unavailable when the launch environment cannot be read', async () => {
    const hostile: NodeJS.ProcessEnv = { HOME: '/missing' };
    Object.defineProperty(hostile, 'PATH', { enumerable: true, get() { throw new Error('PATH unreadable'); } });
    let probes = 0;
    const results = await nativeDetectAgents({}, { state: createAgentRuntimeState({}), env: hostile, modelDiscoveryDeps: modelDeps(),
      probeAgent: async ({ def }) => { probes++; return { ...def, available: true, models: [], modelsSource: 'live' }; } });
    expect(results.every(agent => agent.available === false)).toBe(true);
    expect(probes).toBe(0);
  });

  it('hands each agent its own model context and the injected deps', async () => {
    const deps = modelDeps(); const seen = new Map<string, unknown>();
    const context = { executable: '/x', cwd: '/w', env: {} };
    await nativeDetectAgents({}, { state: createAgentRuntimeState({}), env, modelDiscoveryDeps: deps, modelContextByAgent: { claude: context },
      probeAgent: async ({ def }, options) => { seen.set(def.id, options.context); expect(options.deps).toBe(deps); return { ...def, available: false, models: [], modelsSource: 'fallback' }; } });
    expect(seen.get('claude')).toBe(context);
    expect(seen.get('codex')).toBeUndefined();
  });

  it('falls back to the runtime discovery deps when none are injected', async () => {
    let deps: unknown;
    await nativeDetectAgents({}, { state: createAgentRuntimeState({}), env,
      probeAgent: async ({ def }, options) => { deps = options.deps; return { ...def, available: false, models: [], modelsSource: 'fallback' }; } });
    expect(deps).toEqual(expect.objectContaining({ cache: expect.any(Map) }));
  });

  it('streams with the same per-agent context, deps and probe as the batch path', async () => {
    const deps = modelDeps(); const context = { executable: '/x', cwd: '/w', env: {} }; const seen: unknown[] = [];
    for await (const agent of nativeDetectAgentsStream({}, { state: createAgentRuntimeState({}), env, modelDiscoveryDeps: deps, modelContextByAgent: { claude: context },
      probeAgent: async ({ def }, options) => { if (def.id === 'claude') seen.push(options.context, options.deps); return { ...def, available: false, models: [], modelsSource: 'fallback' }; } })) {
      expect(agent.available).toBe(false);
    }
    expect(seen).toEqual([context, deps]);
  });

  it('streams with the runtime discovery deps when none are injected', async () => {
    let probes = 0;
    for await (const agent of nativeDetectAgentsStream({}, { state: createAgentRuntimeState({}), env,
      probeAgent: async ({ def }, options) => { probes++; expect(options.deps?.cache).toBeInstanceOf(Map); return { ...def, available: false, models: [], modelsSource: 'fallback' }; } })) {
      expect(agent.available).toBe(false);
    }
    expect(probes).toBe(AGENT_DEFS.length);
  });

  it('keeps a cached agent without a version as-is while its catalog is fresh', async () => {
    const state = createAgentRuntimeState({}); let probes = 0;
    const options = { state, env, modelDiscoveryDeps: modelDeps(), probeAgent: async ({ def }: { def: (typeof AGENT_DEFS)[number] }) => { probes++; return { ...def, available: true, models: [], modelsSource: 'live' as const }; } };
    const [first] = await nativeDetectAgents({}, options);
    const [second] = await nativeDetectAgents({}, options);
    expect(second).toBe(first);
    expect(probes).toBe(AGENT_DEFS.length);
  });
});
