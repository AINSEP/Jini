import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
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

import { detectAgents, detectAgentsStream } from '../detection.js';
import { agentCapabilities } from '../capabilities.js';
import { getRememberedLiveModels, rememberLiveModels } from '../models.js';
import { setAcpModelProbe } from '../acp-model-probe.js';
import type { AmrProfileResolver } from '../amr-profile-resolver.js';

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

    const results = await detectAgents(scopedEnv(bin));
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
  // the three spawn-orchestration fields, and two of them carry closures —
  // `JSON.stringify` would drop the functions but keep their wrappers,
  // publishing a misleading `{"buffering":"until-close"}` / `{}`.
  it("strips antigravity's spawn-orchestration fields out of the registry projection", async () => {
    const results = await detectAgents(scopedEnv(path.join(dir, 'nonexistent-cursor-agent')));
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

    const results = await detectAgents(scopedEnv(bin));
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
    const results = await detectAgents(scopedEnv(bin));
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

    const results = await detectAgents(scopedEnv(bin));
    const cursor = results.find((a) => a.id === 'cursor-agent')!;
    expect(cursor.authStatus).toBe('missing');
    expect(cursor.diagnostics?.[0]?.reason).toBe('auth-missing');
  });

  it('reports not-executable when the version probe rejects with EACCES', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), {
      error: Object.assign(new Error('EACCES'), { code: 'EACCES' }),
    });
    const results = await detectAgents(scopedEnv(bin));
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
    const results = await detectAgents(scopedEnv(bin));
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
    const results = await detectAgents(scopedEnv(bin));
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
    const results126 = await detectAgents(scopedEnv(bin));
    expect(results126.find((a) => a.id === 'cursor-agent')!.diagnostics?.[0]?.reason).toBe('not-executable');

    mockState.responses.set(JSON.stringify(['--version']), {
      error: Object.assign(new Error('exit 127'), { code: 127 }),
    });
    const results127 = await detectAgents(scopedEnv(bin));
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
    const results = await detectAgents(scopedEnv(bin));
    const cursor = results.find((a) => a.id === 'cursor-agent')!;
    expect(cursor.available).toBe(true);
    expect(cursor.version).toBeNull();
  });

  it('reports unavailable with a configured-bin-invalid diagnostic when the override points at a missing file', async () => {
    const results = await detectAgents({
      'cursor-agent': { CURSOR_AGENT_BIN: path.join(dir, 'does-not-exist') },
    });
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
      const results = await detectAgents({});
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
    await detectAgents(scopedEnv(bin));
    expect(getRememberedLiveModels('cursor-agent').some((m) => m.id === 'gpt-5')).toBe(true);
  });

  it('a def with a fetchModels function (devin, via ACP) surfaces live models from the injected AcpModelProbe', async () => {
    const bin = path.join(dir, 'devin');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '2.0.0\n' });
    const stub = { detectModels: async () => [{ id: 'adaptive', label: 'Adaptive' }] };
    setAcpModelProbe(stub);
    try {
      const results = await detectAgents({ devin: { DEVIN_BIN: bin } });
      const devin = results.find((a) => a.id === 'devin')!;
      expect(devin.available).toBe(true);
      expect(devin.modelsSource).toBe('live');
      expect(devin.models).toEqual([{ id: 'adaptive', label: 'Adaptive' }]);
    } finally {
      setAcpModelProbe(null);
    }
  });

  it('a def with a fetchModels function falls back when the probe returns an empty list', async () => {
    const bin = path.join(dir, 'devin');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '2.0.0\n' });
    setAcpModelProbe({ detectModels: async () => [] });
    try {
      const results = await detectAgents({ devin: { DEVIN_BIN: bin } });
      const devin = results.find((a) => a.id === 'devin')!;
      expect(devin.modelsSource).toBe('fallback');
      expect(devin.models.some((m) => m.id === 'adaptive')).toBe(true);
    } finally {
      setAcpModelProbe(null);
    }
  });

  it('a def with a fetchModels function falls back when the probe throws', async () => {
    const bin = path.join(dir, 'devin');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '2.0.0\n' });
    setAcpModelProbe({
      detectModels: async () => {
        throw new Error('boom');
      },
    });
    try {
      const results = await detectAgents({ devin: { DEVIN_BIN: bin } });
      const devin = results.find((a) => a.id === 'devin')!;
      expect(devin.modelsSource).toBe('fallback');
    } finally {
      setAcpModelProbe(null);
    }
  });

  it('amr: withRememberedAmrModels falls back to previously remembered live models when the live fetch fails and a scope was remembered', async () => {
    const bin = path.join(dir, 'vela');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '0.9.0\n' });
    // `vela model list --format json` fails with a non-retriable message so
    // fetchVelaRemoteModelsWithRetry throws on the first attempt (no sleep).
    mockState.responses.set(JSON.stringify(['model', 'list', '--format', 'json']), {
      error: new Error('malformed response'),
    });
    const stubResolver: AmrProfileResolver = { resolveProfile: () => 'profile-a' };
    rememberLiveModels('amr', [{ id: 'remembered-model', label: 'Remembered' }], 'profile-a');
    const results = await detectAgents({ amr: { VELA_BIN: bin } }, stubResolver);
    const amr = results.find((a) => a.id === 'amr')!;
    expect(amr.modelsSource).toBe('live');
    // getRememberedLiveModels synthesizes label = id (see models.ts).
    expect(amr.models).toEqual([{ id: 'remembered-model', label: 'remembered-model' }]);
  });

  it('amr: withRememberedAmrModels returns the (empty) fallback unchanged when nothing was remembered for that scope', async () => {
    const bin = path.join(dir, 'vela');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '0.9.0\n' });
    mockState.responses.set(JSON.stringify(['model', 'list', '--format', 'json']), {
      error: new Error('malformed response'),
    });
    const stubResolver: AmrProfileResolver = { resolveProfile: () => 'profile-never-remembered' };
    const results = await detectAgents({ amr: { VELA_BIN: bin } }, stubResolver);
    const amr = results.find((a) => a.id === 'amr')!;
    expect(amr.modelsSource).toBe('fallback');
    expect(amr.models).toEqual([]);
  });

  it('a def with neither listModels nor fetchModels (aider) always reports fallbackModels', async () => {
    const bin = path.join(dir, 'aider');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '0.60.0\n' });
    const results = await detectAgents({ aider: { AIDER_BIN: bin } });
    const aider = results.find((a) => a.id === 'aider')!;
    expect(aider.available).toBe(true);
    expect(aider.modelsSource).toBe('fallback');
    expect(aider.models.some((m) => m.id === 'sonnet')).toBe(true);
  });

  it('safeProbe isolates a fault thrown by an injected amrProfileResolver and reports the agent unavailable', async () => {
    const bin = path.join(dir, 'vela');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '0.9.0\n' });
    // Live model fetch fails (non-retriable), so `probe()` falls through to
    // `withRememberedAmrModels`, which calls straight into the injected
    // resolver with no try/catch of its own — a thrown resolver therefore
    // rejects `probe()` itself, and `safeProbe` must catch that rejection
    // (rather than letting one adapter's fault collapse the whole picker).
    mockState.responses.set(JSON.stringify(['model', 'list', '--format', 'json']), {
      error: new Error('malformed response'),
    });
    const throwingResolver: AmrProfileResolver = {
      resolveProfile: () => {
        throw new Error('resolver blew up');
      },
    };
    const results = await detectAgents({ amr: { VELA_BIN: bin } }, throwingResolver);
    const amr = results.find((a) => a.id === 'amr')!;
    expect(amr.available).toBe(false);
  });

  it('amr: a successful live fetch short-circuits withRememberedAmrModels without consulting remembered state', async () => {
    const bin = path.join(dir, 'vela');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '0.9.0\n' });
    mockState.responses.set(JSON.stringify(['model', 'list', '--format', 'json']), {
      stdout: JSON.stringify({ source: 'remote', data: [{ id: 'live-model', object: 'model' }] }),
    });
    const results = await detectAgents({ amr: { VELA_BIN: bin } });
    const amr = results.find((a) => a.id === 'amr')!;
    expect(amr.modelsSource).toBe('live');
    expect(amr.models.some((m) => m.id === 'live-model')).toBe(true);
  });

  it('detectAgentsStream yields every registered agent exactly once, in completion order', async () => {
    const bin = path.join(dir, 'cursor-agent');
    makeExecutable(bin);
    mockState.responses.set(JSON.stringify(['--version']), { stdout: '1.2.3\n' });
    mockState.responses.set(JSON.stringify(['--help']), { stdout: '' });
    mockState.responses.set(JSON.stringify(['models']), { stdout: 'No models available for this account.' });
    mockState.responses.set(JSON.stringify(['status']), { stdout: 'authenticated' });

    const seenIds: string[] = [];
    for await (const agent of detectAgentsStream(scopedEnv(bin))) {
      seenIds.push(agent.id);
    }
    expect(seenIds.length).toBeGreaterThan(20);
    expect(new Set(seenIds).size).toBe(seenIds.length);
    expect(seenIds).toContain('cursor-agent');
  });

});
