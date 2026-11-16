import { describe, expect, it, vi } from 'vitest';
import type { AgentToolDefinition, ToolExecutionContext, ToolRegistration } from '@jini-ai/core';
import { buildDeployOpsRegistrations } from '../ops-tools.js';
import type { DeployOpsRegistrationHost, SecretConfirm } from '../ops-tool-contracts.js';
import { TOOL_IDS, catchErr, fullModule, makeRuntime } from './ops-fixtures.js';

const PERM = (id: string) => `perm.${id}`;
const READ_ONLY = new Set([TOOL_IDS.status, TOOL_IDS.logs, TOOL_IDS.wait, TOOL_IDS.listTargets, TOOL_IDS.listSecrets]);

function catalogFor(): AgentToolDefinition[] {
  return Object.values(TOOL_IDS).filter(n => n !== TOOL_IDS.credentialVerify).map(name => ({
    name, description: name, sideEffects: READ_ONLY.has(name) ? 'none' : 'external-write', authorization: { permission: PERM(name) },
    inputSchema: { type: 'object' },
  } as unknown as AgentToolDefinition));
}

function makeHost(over: Partial<DeployOpsRegistrationHost> = {}) {
  const catalog = catalogFor();
  const permit = vi.fn(async (_r: { ctx: ToolExecutionContext; permission: string }) => undefined);
  const confirm: SecretConfirm = async () => ({ confirmed: true });
  const confirmFor = vi.fn(() => confirm);
  const host = {
    catalog,
    metadata: {},
    derivedRisk: new Map(catalog.map(t => [t.name, t.sideEffects])),
    domain: 'deploy-ops',
    catalogModule: 'catalog.ts',
    permissions: { write: 'perm.write', siteKey: 'perm.sitekey' },
    permit,
    approvals: { confirmFor },
    cards: { noEmitter: 'NO EMITTER', defaultLocale: 'en' },
    ...over,
  } as unknown as DeployOpsRegistrationHost;
  return { host, permit, confirmFor, confirm };
}

function setup(module = fullModule(), hostOver: Partial<DeployOpsRegistrationHost> = {}, depsOver = {}) {
  const rt = makeRuntime(module, depsOver);
  const h = makeHost(hostOver);
  const regs = buildDeployOpsRegistrations({ deps: rt.deps, host: h.host });
  const byId = new Map<string, ToolRegistration>(regs.map(r => [r.descriptor.id, r]));
  const call = (id: string, input: unknown, signal: AbortSignal = new AbortController().signal, options?: Record<string, unknown>) => {
    const ctx = { executionId: 'e1', principal: { kind: 'user', id: 'u' }, run: { id: 'r' }, input, signal } as unknown as ToolExecutionContext;
    return byId.get(id)!.handler(ctx, options as never);
  };
  return { ...rt, ...h, regs, call, module };
}

const base = { platform: 'p', target: 'owner/app' };

describe('buildDeployOpsRegistrations', () => {
  it('wires one handler per catalog tool with read-only derived from side effects', () => {
    const { regs } = setup();
    expect(regs.map(r => r.descriptor.id).sort()).toEqual([TOOL_IDS.deploy, TOOL_IDS.listSecrets, TOOL_IDS.listTargets, TOOL_IDS.logs, TOOL_IDS.setSecret, TOOL_IDS.status, TOOL_IDS.unsetSecret, TOOL_IDS.wait].sort());
    expect(regs.find(r => r.descriptor.id === TOOL_IDS.status)!.descriptor).toMatchObject({ readOnly: true, sideEffects: 'none' });
    expect(regs.find(r => r.descriptor.id === TOOL_IDS.deploy)!.descriptor).toMatchObject({ readOnly: false });
  });

  it('checks the tool permission before reading any plugin or credential', async () => {
    const denied = new Error('permission denied');
    const { call, permit, deps } = setup();
    permit.mockRejectedValueOnce(denied);
    expect(await catchErr(call(TOOL_IDS.status, base) as Promise<unknown>)).toBe(denied);
    expect(permit.mock.calls[0]![0].permission).toBe(PERM(TOOL_IDS.status));
    expect(deps.loadDeployOps).not.toHaveBeenCalled();
  });

  it('rejects non-object input', async () => {
    const { call } = setup();
    expect((await catchErr(call(TOOL_IDS.status, 'x') as Promise<unknown>)).message).toBe('input must be an object');
    expect((await catchErr(call(TOOL_IDS.deploy, null) as Promise<unknown>)).message).toBe('input must be an object');
  });

  it('returns the setup diagnostic instead of throwing when a credential is missing', async () => {
    const { call, deps } = setup();
    (deps.credentials.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    expect(await call(TOOL_IDS.status, base)).toEqual({ executed: false, credentialSetup: { hint: 'hint-p' } });
    expect(await call(TOOL_IDS.listSecrets, base)).toEqual({ executed: false, credentialSetup: { hint: 'hint-p' } });
  });

  it('rethrows other failures untouched', async () => {
    const { call } = setup();
    expect((await catchErr(call(TOOL_IDS.status, { ...base, platform: 'zz' }) as Promise<unknown>)).message).toMatch(/^Unknown deployment ops platform 'zz'/);
  });
});

describe('string input validation', () => {
  it.each([
    ['missing', undefined],
    ['non-string', 5],
    ['blank', '   '],
    ['empty', ''],
    ['over 200 chars', 'x'.repeat(201)],
  ])('refuses a %s platform', async (_n, platform) => {
    const { call } = setup();
    const input = platform === undefined ? { target: 't' } : { platform, target: 't' };
    expect((await catchErr(call(TOOL_IDS.status, input) as Promise<unknown>)).message).toBe('platform must be a non-empty string of at most 200 characters.');
  });

  it('accepts exactly 200 characters', async () => {
    const { call } = setup();
    expect((await catchErr(call(TOOL_IDS.status, { platform: 'x'.repeat(200), target: 't' }) as Promise<unknown>)).message).toMatch(/^Unknown deployment ops platform/);
  });

  it('refuses a blank optional string but allows it to be absent', async () => {
    const { call } = setup();
    expect((await catchErr(call(TOOL_IDS.status, { ...base, runId: ' ' }) as Promise<unknown>)).message).toBe('runId must be a non-empty string of at most 200 characters.');
    await expect(call(TOOL_IDS.status, base)).resolves.toMatchObject({ state: 'healthy' });
  });
});

describe('deploy tool', () => {
  it('forwards platform, target, ref, workflowFile and credential label', async () => {
    const m = fullModule();
    const { call } = setup(m);
    const res = await call(TOOL_IDS.deploy, { ...base, ref: 'main', workflowFile: 'd.yml', credentialLabel: 'main' });
    expect(res).toEqual({ platform: 'p', target: 'owner/app', started: false, summary: 'refused' });
    expect((m.deploy as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toEqual({ target: 'owner/app', ref: 'main', workflowFile: 'd.yml' });
  });

  it('works with only the required fields', async () => {
    const m = fullModule();
    const { call } = setup(m);
    await call(TOOL_IDS.deploy, base);
    expect((m.deploy as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toEqual({ target: 'owner/app' });
  });

  it('refuses unexpected keys', async () => {
    const { call } = setup();
    expect((await catchErr(call(TOOL_IDS.deploy, { ...base, force: true }) as Promise<unknown>)).message).toBe("Unexpected deployment ops input 'force'.");
  });

  it('stops on an aborted signal', async () => {
    const { call } = setup();
    const ac = new AbortController(); ac.abort();
    expect((await catchErr(call(TOOL_IDS.deploy, base, ac.signal) as Promise<unknown>)).message).toBe('Deployment ops wait was aborted.');
  });
});

describe('observation tools', () => {
  it('status forwards runId and branch', async () => {
    const m = fullModule();
    const { call } = setup(m);
    await call(TOOL_IDS.status, { ...base, runId: '9', branch: 'dev', credentialLabel: 'main' });
    expect((m.status as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({ platform: 'p', target: 'owner/app', runId: '9', branch: 'dev', credentialLabel: 'main' });
  });

  it('logs default to 100 lines and accept an explicit limit', async () => {
    const m = fullModule();
    const { call } = setup(m);
    await call(TOOL_IDS.logs, base);
    await call(TOOL_IDS.logs, { ...base, limit: 500 });
    await call(TOOL_IDS.logs, { ...base, limit: 1 });
    const limits = (m.logs as ReturnType<typeof vi.fn>).mock.calls.map(c => c[1].limit);
    expect(limits).toEqual([100, 500, 1]);
  });

  it.each([0, 501, 1.5, '5', null])('refuses logs limit %j', async limit => {
    const { call } = setup();
    expect((await catchErr(call(TOOL_IDS.logs, { ...base, limit }) as Promise<unknown>)).message).toBe('limit must be an integer from 1 to 500.');
  });

  it('listTargets takes platform, credentialLabel and org, and no target', async () => {
    const m = fullModule();
    const { call } = setup(m);
    const res = await call(TOOL_IDS.listTargets, { platform: 'p', org: 'acme', credentialLabel: 'main' });
    expect(res).toEqual({ platform: 'p', targets: [{ id: 'a', name: 'A' }] });
    expect((m.listTargets as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toEqual({ org: 'acme' });
    expect((await catchErr(call(TOOL_IDS.listTargets, { platform: 'p', target: 't' }) as Promise<unknown>)).message).toBe("Unexpected deployment ops input 'target'.");
  });

  it('refuses keys that belong to another observation tool', async () => {
    const { call } = setup();
    expect((await catchErr(call(TOOL_IDS.status, { ...base, limit: 5 }) as Promise<unknown>)).message).toBe("Unexpected deployment ops input 'limit'.");
    expect((await catchErr(call(TOOL_IDS.logs, { ...base, until: 'healthy' }) as Promise<unknown>)).message).toBe("Unexpected deployment ops input 'until'.");
    expect((await catchErr(call(TOOL_IDS.status, { ...base, org: 'x' }) as Promise<unknown>)).message).toBe("Unexpected deployment ops input 'org'.");
    expect((await catchErr(call(TOOL_IDS.wait, { ...base, limit: 5, until: 'healthy' }) as Promise<unknown>)).message).toBe("Unexpected deployment ops input 'limit'.");
  });

  it('wait returns once healthy', async () => {
    const { call } = setup();
    const res = await call(TOOL_IDS.wait, { ...base, until: 'healthy', timeoutSeconds: 30 }) as { reached: boolean; polls: number; last: { state: string } };
    expect(res).toMatchObject({ reached: true, polls: 1, last: { state: 'healthy' } });
  });

  it('wait with the default timeout accepts until finished', async () => {
    const m = fullModule({ status: vi.fn(async () => ({ platform: 'p', target: 't', state: 'failing' as const, summary: 'x', items: [], checkedAt: 'n' })) });
    const { call } = setup(m);
    expect(await call(TOOL_IDS.wait, { ...base, until: 'finished' })).toMatchObject({ reached: true, last: { state: 'failing' } });
  });

  it('wait times out, reporting the dated placeholder', async () => {
    vi.useFakeTimers();
    try {
      const m = fullModule({ status: vi.fn(() => new Promise<never>(() => undefined)) });
      const waitClock = { now: () => 0, sleep: async () => undefined };
      const { call } = setup(m, undefined, { waitClock });
      const p = call(TOOL_IDS.wait, { ...base, until: 'healthy', timeoutSeconds: 10 }) as Promise<{ reached: boolean; last: unknown }>;
      await vi.advanceTimersByTimeAsync(10_000);
      const res = await p;
      expect(res.reached).toBe(false);
      expect(res.last).toEqual({ platform: 'p', target: 'owner/app', state: 'unknown', summary: 'No status received before timeout.', items: [], checkedAt: '2026-03-04T05:06:07.000Z' });
    } finally { vi.useRealTimers(); }
  });

  it.each([undefined, 'done', 3])('wait refuses until=%j', async until => {
    const { call } = setup();
    const input = until === undefined ? base : { ...base, until };
    expect((await catchErr(call(TOOL_IDS.wait, input) as Promise<unknown>)).message).toBe("until must be 'healthy' or 'finished'.");
  });

  it.each([9, 301, 10.5, '30'])('wait refuses timeoutSeconds %j', async timeoutSeconds => {
    const { call } = setup();
    expect((await catchErr(call(TOOL_IDS.wait, { ...base, until: 'healthy', timeoutSeconds }) as Promise<unknown>)).message).toBe('timeoutSeconds must be an integer from 10 to 300.');
  });
});

describe('secrets tools', () => {
  it('lists secrets', async () => {
    const { call } = setup();
    expect(await call(TOOL_IDS.listSecrets, { ...base, credentialLabel: 'main' })).toMatchObject({ platform: 'p', target: 'owner/app', secrets: [{ name: 'A', digest: 'd' }], truncated: false });
  });

  it('refuses unexpected keys per verb', async () => {
    const { call } = setup();
    expect((await catchErr(call(TOOL_IDS.listSecrets, { ...base, name: 'A' }) as Promise<unknown>)).message).toBe("Unexpected deployment ops input 'name'.");
    expect((await catchErr(call(TOOL_IDS.unsetSecret, { ...base, name: 'A', source: {} }) as Promise<unknown>)).message).toBe("Unexpected deployment ops input 'source'.");
    expect((await catchErr(call(TOOL_IDS.setSecret, { ...base, name: 'A', source: { kind: 'site-key' }, value: 'x' }) as Promise<unknown>)).message).toBe("Unexpected deployment ops input 'value'.");
  });

  it('unset needs a name, builds the confirm channel from the host, and removes', async () => {
    const m = fullModule({ listSecrets: vi.fn(async () => ({ secrets: [{ name: 'OLD', digest: 'd' }] })) });
    const { call, confirmFor, permit } = setup(m);
    expect((await catchErr(call(TOOL_IDS.unsetSecret, base) as Promise<unknown>)).message).toBe('name must be a non-empty string of at most 200 characters.');
    const res = await call(TOOL_IDS.unsetSecret, { ...base, name: 'OLD' });
    expect(res).toMatchObject({ removed: true });
    expect(confirmFor).toHaveBeenCalledTimes(2);
    const [required, options] = confirmFor.mock.calls[1] as unknown as [{ ctx: unknown; permit: (p: string) => Promise<void> }, unknown];
    expect(options).toEqual({});
    await required.permit('x.y');
    expect(permit.mock.calls.at(-1)![0].permission).toBe('x.y');
  });

  it('passes the transport options through to the confirm builder', async () => {
    const { call, confirmFor } = setup();
    const options = { onApprovalStateChange: () => undefined };
    await call(TOOL_IDS.unsetSecret, { ...base, name: 'GONE' }, undefined, options);
    expect(confirmFor.mock.calls[0]![1]).toBe(options);
  });

  it('set from the site key needs the site-key permission first', async () => {
    const m = fullModule();
    const { call, permit } = setup(m);
    const res = await call(TOOL_IDS.setSecret, { ...base, name: 'APP_KEY', source: { kind: 'site-key' } });
    expect(res).toMatchObject({ changed: true, name: 'APP_KEY' });
    expect(permit.mock.calls.map(c => c[0].permission)).toEqual([PERM(TOOL_IDS.setSecret), 'perm.sitekey']);
    expect((m.setSecret as ReturnType<typeof vi.fn>).mock.calls[0]![1].value).toBe('site-key-value');
  });

  it('a denied site-key permission writes nothing', async () => {
    const m = fullModule();
    const { call, permit } = setup(m);
    const denied = new Error('no site key for you');
    permit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(denied);
    expect(await catchErr(call(TOOL_IDS.setSecret, { ...base, name: 'APP_KEY', source: { kind: 'site-key' } }) as Promise<unknown>)).toBe(denied);
    expect(m.setSecret).not.toHaveBeenCalled();
  });

  it('copies one secret to another without the site-key permission, honouring dryRun', async () => {
    const m = fullModule({ readSecret: vi.fn(async (_c, i) => (i.name === 'SRC' ? { value: 'v' } : { absent: true as const })) });
    const { call, permit } = setup(m);
    const res = await call(TOOL_IDS.setSecret, { ...base, name: 'DST', source: { kind: 'secret', name: 'SRC' }, dryRun: true });
    expect(res).toMatchObject({ dryRun: true, changed: false, source: { kind: 'secret', name: 'SRC' } });
    expect(permit).toHaveBeenCalledTimes(1);
    expect(m.setSecret).not.toHaveBeenCalled();
  });

  it('dryRun false is a real write', async () => {
    const m = fullModule();
    const { call } = setup(m);
    await call(TOOL_IDS.setSecret, { ...base, name: 'K', source: { kind: 'site-key' }, dryRun: false });
    expect(m.setSecret).toHaveBeenCalledTimes(1);
  });

  it('refuses a non-boolean dryRun', async () => {
    const { call } = setup();
    expect((await catchErr(call(TOOL_IDS.setSecret, { ...base, name: 'K', source: { kind: 'site-key' }, dryRun: 'yes' }) as Promise<unknown>)).message).toBe('dryRun must be a boolean.');
  });

  const badSource = 'source must be {kind:\'typed\'}, {kind:\'site-key\'} or {kind:\'secret\', name}.';
  it.each([
    ['missing', undefined],
    ['null', null],
    ['string', 'site-key'],
    ['array', []],
    ['unknown kind', { kind: 'value', value: 'x' }],
    ['typed with extra key', { kind: 'typed', value: 'x' }],
    ['site-key with extra key', { kind: 'site-key', name: 'x' }],
    ['secret without name', { kind: 'secret' }],
    ['secret with non-string name', { kind: 'secret', name: 3 }],
    ['secret with extra key', { kind: 'secret', name: 'S', value: 'x' }],
  ])('refuses a %s source so a value can never ride on it', async (_n, source) => {
    const { call } = setup();
    expect((await catchErr(call(TOOL_IDS.setSecret, { ...base, name: 'K', source }) as Promise<unknown>)).message).toBe(badSource);
  });

  it('routes a typed source to the secure card, failing closed with no emitter', async () => {
    const m = fullModule();
    const { call, permit } = setup(m);
    expect((await catchErr(call(TOOL_IDS.setSecret, { ...base, name: 'TOKEN', source: { kind: 'typed' } }) as Promise<unknown>)).message).toBe('NO EMITTER');
    expect(m.setSecret).not.toHaveBeenCalled();
    expect(permit).toHaveBeenCalledTimes(1);
  });

  it('a confirm decision flows to runSetSecret for overwrites', async () => {
    const m = fullModule({ readSecret: vi.fn(async () => ({ value: 'different' })) });
    const { call, confirmFor } = setup(m);
    confirmFor.mockReturnValueOnce((async () => ({ confirmed: false as const, result: { cancelled: true, note: 'no' } })) as SecretConfirm);
    const res = await call(TOOL_IDS.setSecret, { ...base, name: 'K', source: { kind: 'site-key' } });
    expect(res).toMatchObject({ changed: false, cancelled: true, note: 'no' });
    expect(m.setSecret).not.toHaveBeenCalled();
  });
});
