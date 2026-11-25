import { describe, expect, it } from 'vitest';
import type { AgentToolDefinition, ToolExecutionContext } from '@jini-ai/core';
import { buildDeployOpsRegistrations } from '../ops-tools.js';
import type { DeployOpsRegistrationHost, DeployOpsRuntime } from '../ops-tool-contracts.js';
import type { DeployOpsDeployResult, DeployOpsModule, LoadedDeployOps } from '../ops-contracts.js';

const ids = { status: 'lib_state', logs: 'lib_output', wait: 'lib_watch', listTargets: 'lib_targets', deploy: 'lib_launch', listSecrets: 'lib_names', setSecret: 'lib_write', unsetSecret: 'lib_remove', credentialVerify: 'lib_check' };
const accepted = { platform: 'x', target: 'x', started: true, summary: 'Library accepted' };
const execution = (input: unknown, signal = new AbortController().signal): ToolExecutionContext => ({ executionId: 'call', principal: { id: 'librarian' }, run: { id: 'run' }, input, signal });

function wire(module: Partial<DeployOpsModule> = {}) {
  const events: string[] = [];
  const platform = { pluginId: 'p', descriptor: { id: 'library', label: 'Library', module: 'books.mjs', hosts: ['api.library.test'] }, module: {
    status: async () => ({ platform: 'library', target: 'catalog', state: 'healthy', summary: 'ok', items: [], checkedAt: '2026-11-09T00:00:00Z' }),
    deploy: async (ctx: { send(r: { method: string; url: string }): Promise<unknown> }) => { events.push('dispatch'); await ctx.send({ method: 'POST', url: 'https://api.library.test/start' }); return accepted; },
    ...module,
  } } as unknown as LoadedDeployOps;
  const observer = { platform: { ...platform, descriptor: { ...platform.descriptor, id: 'watcher' }, module: { status: platform.module.status } } } as unknown as { platform: LoadedDeployOps };
  const registry = { get: (id: string) => (id === 'library' ? platform : id === 'watcher' ? observer.platform : undefined), list: () => [platform, observer.platform], refusals: [] };
  const deps = {
    workspaceId: 'space', clock: { nowMs: () => 0 }, loadDeployOps: async () => registry,
    credentials: { available: true, list: async () => [{ label: 'key', allowedOrigins: ['https://api.library.test'] }], resolveTarget: async ({ label, url }: { label: string; url: string }) => ({ label, url: new URL(url) }), classifyError: ({ error }: { error: unknown }) => ({ category: 'unknown', error }),
      request: async () => { events.push('http'); return { executed: true, status: 200, headers: {}, bodyText: '{}', bodyTruncated: false }; } },
    siteKey: { read: () => undefined, fingerprint: () => ({ fingerprint: 'f', fingerprintKind: 'sha256' }) },
    publishHistoryStore: { recordSuccess: async () => { events.push('history'); } },
    recovery: { setupRequired: () => ({ message: 'setup', credentialSetup: {} }) }, toolIds: ids,
    messages: { noUsableSiteKey: 'k', severalCredentials: () => 's', noSavedCredential: () => 'n' },
  } as unknown as DeployOpsRuntime;
  const catalog: AgentToolDefinition[] = [ids.deploy, ids.status].map(name => ({ name, description: name, inputSchema: { type: 'object' }, sideEffects: 'mutates-durable-state', authorization: { permission: 'library.change' } }));
  const host = { catalog, metadata: {}, derivedRisk: new Map(catalog.map(c => [c.name, c.sideEffects])), domain: 'library-domain', catalogModule: 'library/operations.ts', permissions: { write: 'w', siteKey: 'k' }, permit: async () => undefined, approvals: { confirmFor: () => undefined }, cards: {} } as unknown as DeployOpsRegistrationHost;
  const call = (name: string, input: unknown, signal?: AbortSignal) => buildDeployOpsRegistrations({ deps, host }, {}).find(r => r.descriptor.id === name)!.handler(execution(input, signal));
  return { deps, events, call };
}

type Seen = { providerId: string | undefined };
function observe(f: ReturnType<typeof wire>) {
  const seen: Seen[] = []; const outcomes: string[] = [];
  f.deps.observeDeploy = async ({ providerId, work }) => {
    seen.push({ providerId }); f.events.push('observe:start');
    try { const r = await work(); outcomes.push(`returned:${String(r.started)}`); return r; } catch (e) { outcomes.push(`threw:${(e as Error).message.slice(0, 20)}`); throw e; }
  };
  return { seen, outcomes };
}
const input = { platform: 'library', target: 'catalog' };

describe('registered deploy observation', () => {
  it('the registered deploy invokes one injected observation and one dispatch', async () => {
    const f = wire(); const o = observe(f);
    const result = await f.call(ids.deploy, input) as DeployOpsDeployResult;
    expect(result).toEqual({ platform: 'library', target: 'catalog', started: true, summary: 'Library accepted' });
    expect(o.seen).toEqual([{ providerId: 'library' }]);
    expect(f.events.filter(e => e === 'dispatch')).toHaveLength(1);
    expect(f.events.filter(e => e === 'history')).toHaveLength(1);
    expect(f.events[0]).toBe('observe:start');
  });

  it('runs the work exactly once when no hook is injected', async () => {
    const f = wire();
    await f.call(ids.deploy, input);
    expect(f.events.filter(e => e === 'dispatch')).toHaveLength(1);
  });

  it('a normalized started:false is a normal return and records no accepted history', async () => {
    const f = wire({ deploy: async () => ({ platform: 'u', target: 'u', started: false, summary: 'Library refused' }) } as never); const o = observe(f);
    const result = await f.call(ids.deploy, input) as DeployOpsDeployResult;
    expect(result.started).toBe(false);
    expect(o.outcomes).toEqual(['returned:false']);
    expect(f.events).not.toContain('history');
  });

  it('observes a pre-abort throw without dispatch', async () => {
    const f = wire(); const o = observe(f); const ac = new AbortController(); ac.abort();
    await expect(f.call(ids.deploy, input, ac.signal)).rejects.toBeDefined();
    expect(o.seen).toHaveLength(1);
    expect(o.outcomes[0]).toMatch(/^threw:/);
    expect(f.events).not.toContain('dispatch');
  });

  it('observes an observe-only platform throw without dispatch, with the raw platform text as providerId', async () => {
    const f = wire(); const o = observe(f);
    await expect(f.call(ids.deploy, { platform: 'watcher', target: 'catalog' })).rejects.toThrow(/observe-only/);
    await expect(f.call(ids.deploy, { platform: 'Some User Text', target: 'catalog' })).rejects.toBeDefined();
    expect(o.seen).toEqual([{ providerId: 'watcher' }, { providerId: 'Some User Text' }]);
    expect(f.events).not.toContain('dispatch');
  });

  it('does not observe status operations', async () => {
    const f = wire(); const o = observe(f);
    await f.call(ids.status, input);
    expect(o.seen).toEqual([]);
  });
});
