import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import {
  DeployCredentialSetupRequired, MAX_MODULE_SLEEP_MS, MAX_RESPONSE_CHARS, MAX_WAIT_SECONDS, aborted, boundContext,
  runDeploy, runDeployOps, waitForDeployOps,
} from '../ops-runner.js';
import type { DeployOpsModule, DeployOpsRegistry, DeployOpsStatus, LoadedDeployOps } from '../ops-contracts.js';
import type { DeployOpsRuntime, WaitClock } from '../ops-tool-contracts.js';

const HOST = 'api.host.example';
const ORIGIN = `https://${HOST}`;

const okStatus = (target = 't'): DeployOpsStatus => ({ platform: 'p', target, state: 'healthy', summary: 's', items: [], checkedAt: 'now' });

function platformOf(module: Partial<DeployOpsModule> = {}, id = 'p'): LoadedDeployOps {
  const full: DeployOpsModule = { status: async () => okStatus(), logs: async () => ({ platform: id, target: 't', lines: [], truncated: false }), ...module };
  return { descriptor: { id, label: id, module: 'm.mjs', hosts: [HOST, 'other.example'] }, pluginId: 'plug', module: full };
}

function registryOf(...platforms: LoadedDeployOps[]): DeployOpsRegistry {
  return { get: id => platforms.find(p => p.descriptor.id === id), list: () => platforms, refusals: [] };
}

function makeDeps(overrides: Partial<DeployOpsRuntime> = {}, platforms: LoadedDeployOps[] = [platformOf()]) {
  const request = vi.fn(async () => ({ status: 200, bodyText: '{"a":1}', bodyTruncated: false }));
  const resolveTarget = vi.fn(async () => undefined);
  const deps = {
    workspaceId: 'ws1',
    clock: { nowMs: () => Date.parse('2026-01-02T03:04:05.000Z') },
    loadDeployOps: vi.fn(async () => registryOf(...platforms)),
    credentials: {
      available: true,
      list: vi.fn(async () => [{ label: 'main', allowedOrigins: [ORIGIN] }]),
      resolveTarget,
      classifyError: vi.fn(({ error }: { error: unknown }) => ({ category: (error as { category?: string }).category ?? 'other' })),
      request,
    },
    recovery: { setupRequired: vi.fn(({ label, baseUrl }: { label: string; baseUrl: string }) => ({ message: `setup ${label} @ ${baseUrl}`, credentialSetup: { hint: `hint-${label}` } })) },
    toolIds: { status: 'ops_status', logs: 'ops_logs', wait: 'ops_wait', listTargets: 'ops_targets', deploy: 'ops_deploy', listSecrets: 'ls', setSecret: 'ss', unsetSecret: 'us', credentialVerify: 'cred_verify' },
    messages: {
      noUsableSiteKey: 'no key',
      severalCredentials: ({ host, labels }: { host: string; labels: readonly string[] }) => `several for ${host}: ${labels.join('|')}`,
      noSavedCredential: ({ label }: { label: string }) => `no saved '${label}'`,
    },
    siteKey: { read: () => undefined, fingerprint: () => ({ fingerprint: 'x', fingerprintKind: 'sha256' as const }) },
    ...overrides,
  } as unknown as DeployOpsRuntime;
  return { deps, request, resolveTarget };
}

const catchErr = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected rejection'); };

describe('constants and helpers', () => {
  it('exposes the documented limits and an abort error', () => {
    expect(MAX_RESPONSE_CHARS).toBe(256_000);
    expect(MAX_WAIT_SECONDS).toBe(300);
    expect(MAX_MODULE_SLEEP_MS).toBe(5_000);
    const err = aborted();
    expect(err).toBeInstanceOf(ToolInputError);
    expect(err.message).toBe('Deployment ops wait was aborted.');
  });
});

describe('boundContext credential selection', () => {
  it('refuses when the HTTP client is unavailable', async () => {
    const { deps } = makeDeps();
    (deps.credentials as { available: boolean }).available = false;
    const err = await catchErr(boundContext({ deps, platform: platformOf() }));
    expect(err).toBeInstanceOf(ToolInputError);
    expect(err.message).toBe('Deployment ops HTTP client is unavailable. Restart the site to rebuild its tool dependencies.');
  });

  it('raises setup-required carrying the issued diagnostic when an explicit label is not saved', async () => {
    const { deps } = makeDeps();
    const err = await catchErr(boundContext({ deps, platform: platformOf(), explicit: 'ghost' }));
    expect(err).toBeInstanceOf(DeployCredentialSetupRequired);
    expect(err).toBeInstanceOf(ToolInputError);
    expect(err.message).toBe(`setup ghost @ ${ORIGIN}`);
    expect((err as DeployCredentialSetupRequired).credentialSetup).toEqual({ hint: 'hint-ghost' });
    expect(deps.recovery.setupRequired).toHaveBeenCalledWith({ label: 'ghost', baseUrl: ORIGIN });
  });

  it('uses an explicit label that exists, without consulting host matching', async () => {
    const { deps, request } = makeDeps();
    (deps.credentials.list as ReturnType<typeof vi.fn>).mockResolvedValue([{ label: 'a', allowedOrigins: [] }, { label: 'b', allowedOrigins: [ORIGIN] }]);
    const ctx = await boundContext({ deps, platform: platformOf(), explicit: 'a' });
    await ctx.get(`${ORIGIN}/x`);
    expect(request.mock.calls[0]![0]).toEqual({ workspaceId: 'ws1', label: 'a', method: 'GET', url: `${ORIGIN}/x`, maxResponseBytes: MAX_RESPONSE_CHARS });
  });

  it('asks for setup under the platform id when no saved credential matches the host', async () => {
    const { deps } = makeDeps();
    (deps.credentials.list as ReturnType<typeof vi.fn>).mockResolvedValue([{ label: 'x', allowedOrigins: ['https://elsewhere.example'] }]);
    const err = await catchErr(boundContext({ deps, platform: platformOf({}, 'my-plat') }));
    expect(err).toBeInstanceOf(DeployCredentialSetupRequired);
    expect(err.message).toBe(`setup my-plat @ ${ORIGIN}`);
  });

  it('refuses several matching credentials, listing their labels sorted', async () => {
    const { deps } = makeDeps();
    (deps.credentials.list as ReturnType<typeof vi.fn>).mockResolvedValue([{ label: 'zeta', allowedOrigins: [ORIGIN] }, { label: 'alpha', allowedOrigins: [ORIGIN] }]);
    const err = await catchErr(boundContext({ deps, platform: platformOf() }));
    expect(err).toBeInstanceOf(ToolInputError);
    expect(err).not.toBeInstanceOf(DeployCredentialSetupRequired);
    expect(err.message).toBe(`several for ${HOST}: alpha|zeta`);
  });

  it('picks the single matching credential', async () => {
    const { deps, request } = makeDeps();
    const ctx = await boundContext({ deps, platform: platformOf() });
    await ctx.get(`${ORIGIN}/v1`);
    expect(request.mock.calls[0]![0].label).toBe('main');
  });
});

describe('boundContext get and response normalisation', () => {
  it('parses JSON bodies and reports status, text and truncation', async () => {
    const { deps } = makeDeps();
    const ctx = await boundContext({ deps, platform: platformOf() });
    expect(await ctx.get(`${ORIGIN}/v1`)).toEqual({ status: 200, json: { a: 1 }, text: '{"a":1}', truncated: false });
  });

  it('keeps a JSON null body as json: null', async () => {
    const { deps, request } = makeDeps();
    request.mockResolvedValue({ status: 200, bodyText: 'null', bodyTruncated: false });
    const ctx = await boundContext({ deps, platform: platformOf() });
    expect(await ctx.get(`${ORIGIN}/v1`)).toEqual({ status: 200, json: null, text: 'null', truncated: false });
  });

  it('leaves plain-text logs as text only', async () => {
    const { deps, request } = makeDeps();
    request.mockResolvedValue({ status: 201, bodyText: 'line one\nline two', bodyTruncated: false });
    const ctx = await boundContext({ deps, platform: platformOf() });
    expect(await ctx.get(`${ORIGIN}/logs`)).toEqual({ status: 201, text: 'line one\nline two', truncated: false });
  });

  it('never parses a transport-truncated body even when it is valid JSON', async () => {
    const { deps, request } = makeDeps();
    request.mockResolvedValue({ status: 200, bodyText: '{"a":1}', bodyTruncated: true });
    const ctx = await boundContext({ deps, platform: platformOf() });
    expect(await ctx.get(`${ORIGIN}/v1`)).toEqual({ status: 200, text: '{"a":1}', truncated: true });
  });

  it('clips an oversized body to the cap and marks it truncated', async () => {
    const { deps, request } = makeDeps();
    const big = '"' + 'x'.repeat(MAX_RESPONSE_CHARS + 50) + '"';
    request.mockResolvedValue({ status: 200, bodyText: big, bodyTruncated: false });
    const ctx = await boundContext({ deps, platform: platformOf() });
    const res = await ctx.get(`${ORIGIN}/big`);
    expect(res.truncated).toBe(true);
    expect(res.text).toHaveLength(MAX_RESPONSE_CHARS);
    expect(res.json).toBeUndefined();
  });

  it.each([401, 403])('names the verify tool when the credential is rejected with HTTP %i', async status => {
    const { deps, request } = makeDeps();
    request.mockResolvedValue({ status, bodyText: 'secret provider text', bodyTruncated: false });
    const ctx = await boundContext({ deps, platform: platformOf() });
    const err = await catchErr(ctx.get(`${ORIGIN}/v1`));
    expect(err.message).toBe(`Credential 'main' was rejected (HTTP ${status}). Run cred_verify with label 'main' and check its saved token/scopes.`);
    expect(err.message).not.toContain('secret provider text');
  });

  it.each([199, 302, 404, 500])('reports HTTP %i without following redirects', async status => {
    const { deps, request } = makeDeps();
    request.mockResolvedValue({ status, bodyText: '', bodyTruncated: false });
    const ctx = await boundContext({ deps, platform: platformOf() });
    const err = await catchErr(ctx.get(`${ORIGIN}/v1`));
    expect(err.message).toBe(`Deployment ops host '${HOST}' returned HTTP ${status}. Check the target and retry; redirects are not followed.`);
  });
});

describe('boundContext URL binding', () => {
  const cases: Array<[string, string, string]> = [
    ['unparseable', 'not a url', 'Deployment ops module supplied an invalid URL.'],
    ['http', `http://${HOST}/x`, `Deployment ops platform 'p' does not allow host '${HOST}'.`],
    ['userinfo username', `https://u@${HOST}/x`, `Deployment ops platform 'p' does not allow host '${HOST}'.`],
    ['userinfo password', `https://u:pw@${HOST}/x`, `Deployment ops platform 'p' does not allow host '${HOST}'.`],
    ['port', `https://${HOST}:8443/x`, `Deployment ops platform 'p' does not allow host '${HOST}'.`],
    ['foreign host', 'https://evil.example/x', "Deployment ops platform 'p' does not allow host 'evil.example'."],
  ];
  it.each(cases)('rejects a %s URL before any credentialed request', async (_name, url, message) => {
    const { deps, request, resolveTarget } = makeDeps();
    const ctx = await boundContext({ deps, platform: platformOf() });
    const err = await catchErr(ctx.get(url));
    expect(err).toBeInstanceOf(ToolInputError);
    expect(err.message).toBe(message);
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('accepts a second declared host of the platform', async () => {
    const { deps, request } = makeDeps();
    const ctx = await boundContext({ deps, platform: platformOf() });
    await ctx.get('https://other.example/x');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('checks the credential binding with workspace, label and the raw URL', async () => {
    const { deps, resolveTarget } = makeDeps();
    const ctx = await boundContext({ deps, platform: platformOf() });
    await ctx.get(`${ORIGIN}/v1`);
    expect(resolveTarget).toHaveBeenCalledWith({ workspaceId: 'ws1', label: 'main', url: `${ORIGIN}/v1` }, {});
  });

  it('turns a validation refusal into a host-not-allowed message', async () => {
    const { deps, request, resolveTarget } = makeDeps();
    resolveTarget.mockRejectedValue({ category: 'validation' });
    const ctx = await boundContext({ deps, platform: platformOf() });
    const err = await catchErr(ctx.get(`${ORIGIN}/v1`));
    expect(err.message).toBe(`Credential 'main' does not allow host '${HOST}'. Add that host to the saved credential or choose another credentialLabel.`);
    expect(request).not.toHaveBeenCalled();
  });

  it('turns a not-found refusal into the host no-saved-credential message', async () => {
    const { deps, resolveTarget } = makeDeps();
    resolveTarget.mockRejectedValue({ category: 'not-found' });
    const ctx = await boundContext({ deps, platform: platformOf() });
    expect((await catchErr(ctx.get(`${ORIGIN}/v1`))).message).toBe("no saved 'main'");
  });

  it('rethrows an unclassified binding failure unchanged', async () => {
    const { deps, resolveTarget } = makeDeps();
    const boom = Object.assign(new Error('vault down'), { category: 'other' });
    resolveTarget.mockRejectedValue(boom);
    const ctx = await boundContext({ deps, platform: platformOf() });
    expect(await catchErr(ctx.get(`${ORIGIN}/v1`))).toBe(boom);
  });
});

describe('boundContext request failures', () => {
  const failing = async (error: unknown, call: (ctx: Awaited<ReturnType<typeof boundContext>>) => Promise<unknown>, opts?: { signal?: AbortSignal; allowDelete?: boolean }) => {
    const { deps, request } = makeDeps();
    request.mockRejectedValue(error);
    const ctx = await boundContext({ deps, platform: platformOf() }, opts);
    return catchErr(call(ctx));
  };

  it('describes an egress refusal', async () => {
    const err = await failing({ category: 'egress-refused' }, c => c.get(`${ORIGIN}/v1`));
    expect(err.message).toBe(`Deployment ops host '${HOST}' was refused by outbound HTTP policy. Use a public HTTPS endpoint allowed by the saved credential.`);
  });

  it('tells the caller to retry a failed GET transport', async () => {
    const err = await failing({ category: 'transport' }, c => c.get(`${ORIGIN}/v1`));
    expect(err.message).toBe(`Could not reach deployment ops host '${HOST}' using credential 'main'. Retry the check.`);
  });

  it('warns that a write may have landed when the transport dies mid-POST', async () => {
    const err = await failing({ category: 'transport' }, c => c.send({ method: 'POST', url: `${ORIGIN}/v1` }));
    expect(err.message).toBe(`Lost the connection to deployment ops host '${HOST}' during a POST; it may or may not have been accepted. Check ops_status before retrying.`);
  });

  it.each(['validation', 'not-found'])('reports a changed credential for category %s', async category => {
    const err = await failing({ category }, c => c.get(`${ORIGIN}/v1`));
    expect(err.message).toBe(`Credential 'main' changed or no longer allows host '${HOST}'. Check its saved hosts or choose another credentialLabel.`);
  });

  it('rethrows an unrecognised request error as-is', async () => {
    const boom = new Error('weird');
    expect(await failing(boom, c => c.get(`${ORIGIN}/v1`))).toBe(boom);
  });

  it('reports cancellation instead of the transport error when the signal is aborted', async () => {
    const { deps, request } = makeDeps();
    const ac = new AbortController();
    request.mockImplementation(async () => { ac.abort(); throw { category: 'transport' }; });
    const ctx = await boundContext({ deps, platform: platformOf() }, { signal: ac.signal });
    expect((await catchErr(ctx.get(`${ORIGIN}/v1`))).message).toBe('Deployment ops wait was aborted.');
  });
});

describe('boundContext cancellation checkpoints', () => {
  it('refuses to start a call on an already-aborted signal', async () => {
    const { deps, request } = makeDeps();
    const ac = new AbortController();
    const ctx = await boundContext({ deps, platform: platformOf() }, { signal: ac.signal });
    ac.abort();
    expect((await catchErr(ctx.get(`${ORIGIN}/v1`))).message).toBe('Deployment ops wait was aborted.');
    expect(request).not.toHaveBeenCalled();
  });

  it('stops after credential binding when aborted meanwhile', async () => {
    const { deps, request, resolveTarget } = makeDeps();
    const ac = new AbortController();
    resolveTarget.mockImplementation(async () => { ac.abort(); });
    const ctx = await boundContext({ deps, platform: platformOf() }, { signal: ac.signal });
    expect((await catchErr(ctx.get(`${ORIGIN}/v1`))).message).toBe('Deployment ops wait was aborted.');
    expect(request).not.toHaveBeenCalled();
  });

  it('discards a response that arrives after the signal was aborted', async () => {
    const { deps, request } = makeDeps();
    const ac = new AbortController();
    request.mockImplementation(async () => { ac.abort(); return { status: 200, bodyText: '{}', bodyTruncated: false }; });
    const ctx = await boundContext({ deps, platform: platformOf() }, { signal: ac.signal });
    expect((await catchErr(ctx.get(`${ORIGIN}/v1`))).message).toBe('Deployment ops wait was aborted.');
  });

  it('forwards the signal to the transport', async () => {
    const { deps, request } = makeDeps();
    const ac = new AbortController();
    const ctx = await boundContext({ deps, platform: platformOf() }, { signal: ac.signal });
    await ctx.get(`${ORIGIN}/v1`);
    expect(request.mock.calls[0]![1]).toEqual({ signal: ac.signal });
  });
});

describe('boundContext send', () => {
  it('serialises a JSON body with content-type and accept', async () => {
    const { deps, request } = makeDeps();
    const ctx = await boundContext({ deps, platform: platformOf() });
    await ctx.send({ method: 'PATCH', url: `${ORIGIN}/v1`, body: { k: [1] } });
    expect(request.mock.calls[0]![0]).toMatchObject({ method: 'PATCH', url: `${ORIGIN}/v1` });
    expect(request.mock.calls[0]![1]).toEqual({ headers: { 'content-type': 'application/json', accept: 'application/json' }, body: '{"k":[1]}', signal: undefined });
  });

  it('sends a bodyless write with accept only', async () => {
    const { deps, request } = makeDeps();
    const ctx = await boundContext({ deps, platform: platformOf() });
    await ctx.send({ method: 'PUT', url: `${ORIGIN}/v1` });
    expect(request.mock.calls[0]![1]).toEqual({ headers: { accept: 'application/json' }, signal: undefined });
    expect(request.mock.calls[0]![1]).not.toHaveProperty('body');
  });

  it('sends a plain GET without write headers', async () => {
    const { deps, request } = makeDeps();
    const ctx = await boundContext({ deps, platform: platformOf() });
    await ctx.get(`${ORIGIN}/v1`);
    expect(request.mock.calls[0]![1]).not.toHaveProperty('headers');
    expect(request.mock.calls[0]![1]).not.toHaveProperty('body');
  });

  it('refuses DELETE unless the secret-removal verb opted in', async () => {
    const { deps, request } = makeDeps();
    const ctx = await boundContext({ deps, platform: platformOf() });
    expect(() => ctx.send({ method: 'DELETE', url: `${ORIGIN}/v1` })).toThrow("Deployment ops module supplied unsupported method 'DELETE'.");
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses an unknown method even with allowDelete', async () => {
    const { deps } = makeDeps();
    const ctx = await boundContext({ deps, platform: platformOf() }, { allowDelete: true });
    expect(() => ctx.send({ method: 'TRACE' as never, url: `${ORIGIN}/v1` })).toThrow("unsupported method 'TRACE'");
  });

  it('allows DELETE when the secret-removal verb opted in', async () => {
    const { deps, request } = makeDeps();
    const ctx = await boundContext({ deps, platform: platformOf() }, { allowDelete: true });
    await ctx.send({ method: 'DELETE', url: `${ORIGIN}/v1` });
    expect(request.mock.calls[0]![0].method).toBe('DELETE');
  });
});

describe('boundContext module helpers', () => {
  it('reads time from the injected clock', async () => {
    const { deps } = makeDeps();
    const ctx = await boundContext({ deps, platform: platformOf() });
    expect(ctx.nowIso()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('fail throws a model-visible ToolInputError', async () => {
    const { deps } = makeDeps();
    const ctx = await boundContext({ deps, platform: platformOf() });
    expect(() => ctx.fail('no such app')).toThrow(ToolInputError);
    expect(() => ctx.fail('no such app')).toThrow('no such app');
  });

  it.each([[250, 250], [-5, 0], [Number.NaN, 0], ['abc' as unknown as number, 0], [99_999, MAX_MODULE_SLEEP_MS]])('sleep(%s) pauses for %s ms via the injected clock', async (input, expected) => {
    const sleep = vi.fn(async () => undefined);
    const { deps } = makeDeps({ waitClock: { now: () => 0, sleep } });
    const ac = new AbortController();
    const ctx = await boundContext({ deps, platform: platformOf() }, { signal: ac.signal });
    await ctx.sleep(input);
    expect(sleep).toHaveBeenCalledWith(expected, ac.signal);
  });

  describe('system clock sleep', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('resolves after the pause and removes its abort listener', async () => {
      vi.useFakeTimers();
      const { deps } = makeDeps();
      const ac = new AbortController();
      const remove = vi.spyOn(ac.signal, 'removeEventListener');
      const ctx = await boundContext({ deps, platform: platformOf() }, { signal: ac.signal });
      const done = vi.fn();
      const p = ctx.sleep(1000).then(done);
      await vi.advanceTimersByTimeAsync(999);
      expect(done).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(done).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('sleeps without a signal', async () => {
      vi.useFakeTimers();
      const { deps } = makeDeps();
      const ctx = await boundContext({ deps, platform: platformOf() });
      const p = ctx.sleep(10);
      await vi.advanceTimersByTimeAsync(10);
      await expect(p).resolves.toBeUndefined();
    });

    it('rejects at once for a pre-aborted signal, without arming a timer', async () => {
      vi.useFakeTimers();
      const { deps } = makeDeps();
      const ac = new AbortController();
      const ctx = await boundContext({ deps, platform: platformOf() }, { signal: ac.signal });
      ac.abort();
      await expect(ctx.sleep(1000)).rejects.toThrow('Deployment ops wait was aborted.');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects and clears its timer when aborted mid-sleep', async () => {
      vi.useFakeTimers();
      const { deps } = makeDeps();
      const ac = new AbortController();
      const ctx = await boundContext({ deps, platform: platformOf() }, { signal: ac.signal });
      const p = ctx.sleep(4000);
      const assertion = expect(p).rejects.toThrow('Deployment ops wait was aborted.');
      expect(vi.getTimerCount()).toBe(1);
      ac.abort();
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

describe('runDeployOps', () => {
  const input = { platform: 'p', target: 'owner/app' };

  it('refuses an already-aborted signal before loading anything', async () => {
    const { deps } = makeDeps();
    const ac = new AbortController(); ac.abort();
    const err = await catchErr(runDeployOps({ deps, input, operation: 'status' }, { signal: ac.signal }));
    expect(err.message).toBe('Deployment ops wait was aborted.');
    expect(deps.loadDeployOps).not.toHaveBeenCalled();
  });

  it('refuses an unknown platform naming the choices', async () => {
    const { deps } = makeDeps();
    const err = await catchErr(runDeployOps({ deps, input: { ...input, platform: 'nope' }, operation: 'status' }, {}));
    expect(err.message).toBe("Unknown deployment ops platform 'nope'. Choose: p.");
  });

  it('passes the status module the whole input and returns its result', async () => {
    const status = vi.fn(async () => okStatus('owner/app'));
    const { deps } = makeDeps({}, [platformOf({ status })]);
    const result = await runDeployOps({ deps, input: { ...input, runId: '7', branch: 'main' }, operation: 'status' }, {});
    expect(result).toEqual(okStatus('owner/app'));
    expect(status).toHaveBeenCalledTimes(1);
    expect(status.mock.calls[0]![1]).toEqual({ ...input, runId: '7', branch: 'main' });
    expect(deps.loadDeployOps).toHaveBeenCalledWith({ workspaceId: 'ws1' });
  });

  it('defaults logs to 100 lines', async () => {
    const logs = vi.fn(async () => ({ platform: 'p', target: 't', lines: [{ message: 'hi' }], truncated: false }));
    const { deps } = makeDeps({}, [platformOf({ logs })]);
    const result = await runDeployOps({ deps, input, operation: 'logs' }, {});
    expect(result).toEqual({ platform: 'p', target: 't', lines: [{ message: 'hi' }], truncated: false });
    expect(logs.mock.calls[0]![1]).toEqual({ ...input, limit: 100 });
  });

  it('keeps an explicit logs limit', async () => {
    const logs = vi.fn(async () => ({ platform: 'p', target: 't', lines: [], truncated: true }));
    const { deps } = makeDeps({}, [platformOf({ logs })]);
    await runDeployOps({ deps, input: { ...input, limit: 5 }, operation: 'logs' }, {});
    expect(logs.mock.calls[0]![1]).toEqual({ ...input, limit: 5 });
  });

  it('lists targets for the requested org', async () => {
    const listTargets = vi.fn(async () => ({ platform: 'p', targets: [{ id: 'a', name: 'A' }] }));
    const { deps } = makeDeps({}, [platformOf({ listTargets })]);
    const result = await runDeployOps({ deps, input: { ...input, org: 'acme' }, operation: 'listTargets' }, {});
    expect(result).toEqual({ platform: 'p', targets: [{ id: 'a', name: 'A' }] });
    expect(listTargets.mock.calls[0]![1]).toEqual({ org: 'acme' });
  });

  it('refuses listing targets on a platform that cannot, pointing at the status tool', async () => {
    const { deps } = makeDeps();
    const err = await catchErr(runDeployOps({ deps, input, operation: 'listTargets' }, {}));
    expect(err.message).toBe("Deployment ops platform 'p' does not support listing targets. Supply a target for ops_status.");
  });

  it('propagates credential setup problems', async () => {
    const { deps } = makeDeps();
    (deps.credentials.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const err = await catchErr(runDeployOps({ deps, input, operation: 'status' }, {}));
    expect(err).toBeInstanceOf(DeployCredentialSetupRequired);
  });

  it('stops before calling the module when aborted while the credential is resolved', async () => {
    const status = vi.fn(async () => okStatus());
    const { deps } = makeDeps({}, [platformOf({ status })]);
    const ac = new AbortController();
    (deps.credentials.list as ReturnType<typeof vi.fn>).mockImplementation(async () => { ac.abort(); return [{ label: 'main', allowedOrigins: [ORIGIN] }]; });
    const err = await catchErr(runDeployOps({ deps, input, operation: 'status' }, { signal: ac.signal }));
    expect(err.message).toBe('Deployment ops wait was aborted.');
    expect(status).not.toHaveBeenCalled();
  });

  it('hands the module a context bound to the resolved credential', async () => {
    const status = vi.fn(async (ctx: Parameters<DeployOpsModule['status']>[0]) => {
      const res = await ctx.get(`${ORIGIN}/state`);
      return { ...okStatus(), summary: JSON.stringify(res.json) };
    });
    const { deps, request } = makeDeps({}, [platformOf({ status })]);
    const result = await runDeployOps({ deps, input, operation: 'status' }, {}) as DeployOpsStatus;
    expect(result.summary).toBe('{"a":1}');
    expect(request.mock.calls[0]![0].label).toBe('main');
  });
});

describe('runDeploy', () => {
  const input = { platform: 'p', target: 'owner/app' };
  const deployer = (result: unknown) => vi.fn(async () => result as never);

  it('refuses an already-aborted signal', async () => {
    const { deps } = makeDeps();
    const ac = new AbortController(); ac.abort();
    expect((await catchErr(runDeploy({ deps, input }, { signal: ac.signal }))).message).toBe('Deployment ops wait was aborted.');
    expect(deps.loadDeployOps).not.toHaveBeenCalled();
  });

  it('refuses an unknown platform', async () => {
    const { deps } = makeDeps();
    expect((await catchErr(runDeploy({ deps, input: { ...input, platform: 'zzz' } }))).message).toBe("Unknown deployment ops platform 'zzz'. Choose: p.");
  });

  it('refuses an observe-only platform and lists those that can deploy', async () => {
    const { deps } = makeDeps({}, [platformOf({}, 'p'), platformOf({ deploy: deployer({}) }, 'q'), platformOf({ deploy: deployer({}) }, 'r')]);
    expect((await catchErr(runDeploy({ deps, input }))).message).toBe("Deployment ops platform 'p' cannot deploy; it is observe-only. Platforms that can deploy: q, r.");
  });

  it('says none can deploy when no platform does', async () => {
    const { deps } = makeDeps();
    expect((await catchErr(runDeploy({ deps, input }))).message).toBe("Deployment ops platform 'p' cannot deploy; it is observe-only. Platforms that can deploy: (none).");
  });

  it('normalises an accepted deploy, taking platform and target from the request', async () => {
    const deploy = deployer({ platform: 'EVIL', target: 'EVIL', started: true, summary: 'ok', runId: 42, sha: 'abc', machineIds: ['m1', 'm2'], image: 'img:1', url: 'https://app.example', extra: 'dropped' });
    const { deps } = makeDeps({}, [platformOf({ deploy })]);
    expect(await runDeploy({ deps, input })).toEqual({ platform: 'p', target: 'owner/app', started: true, summary: 'ok', runId: '42', sha: 'abc', machineIds: ['m1', 'm2'], image: 'img:1', url: 'https://app.example' });
  });

  it('returns a minimal result when the module supplies only the required fields', async () => {
    const { deps } = makeDeps({}, [platformOf({ deploy: deployer({ started: false, summary: 'refused' }) })]);
    expect(await runDeploy({ deps, input })).toEqual({ platform: 'p', target: 'owner/app', started: false, summary: 'refused' });
  });

  it('clips long strings to 2000 chars, caps machine ids at 32 and drops non-https urls', async () => {
    const long = 'x'.repeat(3000);
    const ids = Array.from({ length: 40 }, (_, i) => `m${i}`);
    const deploy = deployer({ started: false, summary: long, sha: long, image: long, machineIds: ids, url: 'http://insecure.example' });
    const { deps } = makeDeps({}, [platformOf({ deploy })]);
    const res = await runDeploy({ deps, input });
    expect(res.summary).toHaveLength(2000);
    expect(res.sha).toHaveLength(2000);
    expect(res.image).toHaveLength(2000);
    expect(res.machineIds).toEqual(ids.slice(0, 32));
    expect(res).not.toHaveProperty('url');
  });

  it('ignores machineIds that are not an array and non-string sha/image/url', async () => {
    const deploy = deployer({ started: false, summary: 's', machineIds: 'm1', sha: 5, image: 6, url: 7 });
    const { deps } = makeDeps({}, [platformOf({ deploy })]);
    expect(await runDeploy({ deps, input })).toEqual({ platform: 'p', target: 'owner/app', started: false, summary: 's' });
  });

  it.each([
    ['missing started', { summary: 's' }],
    ['non-boolean started', { started: 'yes', summary: 's' }],
    ['missing summary', { started: true }],
    ['non-string summary', { started: true, summary: 3 }],
    ['null result', null],
  ])('rejects an invalid deploy result: %s', async (_name, result) => {
    const { deps } = makeDeps({}, [platformOf({ deploy: deployer(result) })]);
    expect((await catchErr(runDeploy({ deps, input }))).message).toBe("Deployment ops platform 'p' returned an invalid deploy result.");
  });

  it.each(['-bad', 'has space', '', 'a'.repeat(129), 'sl/ash'])('rejects the run id %j', async runId => {
    const { deps } = makeDeps({}, [platformOf({ deploy: deployer({ started: true, summary: 's', runId }) })]);
    expect((await catchErr(runDeploy({ deps, input }))).message).toBe("Deployment ops platform 'p' returned an invalid run id.");
  });

  it('accepts a 128-char run id', async () => {
    const runId = 'a' + 'b'.repeat(127);
    const { deps } = makeDeps({}, [platformOf({ deploy: deployer({ started: false, summary: 's', runId }) })]);
    expect((await runDeploy({ deps, input })).runId).toBe(runId);
  });

  it('passes only the supplied request fields plus workflow files to the adapter', async () => {
    const deploy = vi.fn(async () => ({ started: false, summary: 's' }));
    const loadDeployWorkflowFiles = vi.fn(async () => ['deploy.yml', 'ci.yml']);
    const { deps } = makeDeps({ loadDeployWorkflowFiles }, [platformOf({ deploy })]);
    await runDeploy({ deps, input: { ...input, ref: 'main', workflowFile: 'deploy.yml' } });
    expect(loadDeployWorkflowFiles).toHaveBeenCalledWith({ workspaceId: 'ws1' });
    expect(deploy.mock.calls[0]![1]).toEqual({ target: 'owner/app', ref: 'main', workflowFile: 'deploy.yml', workflowFiles: ['deploy.yml', 'ci.yml'] });
  });

  it('omits optional adapter fields that were not supplied', async () => {
    const deploy = vi.fn(async () => ({ started: false, summary: 's' }));
    const { deps } = makeDeps({}, [platformOf({ deploy })]);
    await runDeploy({ deps, input });
    const passed = deploy.mock.calls[0]![1] as Record<string, unknown>;
    expect(passed).toEqual({ target: 'owner/app' });
    expect(Object.keys(passed)).toEqual(['target']);
  });

  it('uses the explicit credential label', async () => {
    const deploy = vi.fn(async (ctx: Parameters<NonNullable<DeployOpsModule['deploy']>>[0]) => { await ctx.get(`${ORIGIN}/x`); return { started: false, summary: 's' }; });
    const { deps, request } = makeDeps({}, [platformOf({ deploy })]);
    (deps.credentials.list as ReturnType<typeof vi.fn>).mockResolvedValue([{ label: 'ci', allowedOrigins: [] }]);
    await runDeploy({ deps, input: { ...input, credentialLabel: 'ci' } });
    expect(request.mock.calls[0]![0].label).toBe('ci');
  });

  it('stops before calling the adapter when aborted while resolving the credential', async () => {
    const deploy = vi.fn(async () => ({ started: true, summary: 's' }));
    const { deps } = makeDeps({}, [platformOf({ deploy })]);
    const ac = new AbortController();
    (deps.credentials.list as ReturnType<typeof vi.fn>).mockImplementation(async () => { ac.abort(); return [{ label: 'main', allowedOrigins: [ORIGIN] }]; });
    expect((await catchErr(runDeploy({ deps, input }, { signal: ac.signal }))).message).toBe('Deployment ops wait was aborted.');
    expect(deploy).not.toHaveBeenCalled();
  });

  describe('publish history', () => {
    it('records an accepted deploy as pending, never reachable', async () => {
      const recordSuccess = vi.fn(async () => undefined);
      const deploy = deployer({ started: true, summary: 's', url: 'https://app.example' });
      const { deps } = makeDeps({ publishHistoryStore: { recordSuccess } }, [platformOf({ deploy })]);
      await runDeploy({ deps, input });
      expect(recordSuccess).toHaveBeenCalledWith({ workspaceId: 'ws1', entry: {
        kind: 'deploy', target: 'p', projectName: 'owner/app', url: 'https://app.example', reachable: false,
        status: 'started', publishedAt: '2026-01-02T03:04:05.000Z', triggeredBy: 'agent_tool',
      } });
    });

    it('records an empty url when the adapter supplied none', async () => {
      const recordSuccess = vi.fn(async () => undefined);
      const { deps } = makeDeps({ publishHistoryStore: { recordSuccess } }, [platformOf({ deploy: deployer({ started: true, summary: 's' }) })]);
      await runDeploy({ deps, input });
      expect((recordSuccess.mock.calls[0] as unknown as [{ entry: { url: string } }])[0].entry.url).toBe('');
    });

    it('records nothing for a refused deploy', async () => {
      const recordSuccess = vi.fn(async () => undefined);
      const { deps } = makeDeps({ publishHistoryStore: { recordSuccess } }, [platformOf({ deploy: deployer({ started: false, summary: 'no' }) })]);
      await runDeploy({ deps, input });
      expect(recordSuccess).not.toHaveBeenCalled();
    });

    it('works with no history store configured', async () => {
      const { deps } = makeDeps({}, [platformOf({ deploy: deployer({ started: true, summary: 's' }) })]);
      expect((await runDeploy({ deps, input })).started).toBe(true);
    });

    it('survives a ledger failure, warning without leaking the error', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const recordSuccess = vi.fn(async () => { throw new Error('password=hunter2'); });
        const { deps } = makeDeps({ publishHistoryStore: { recordSuccess } }, [platformOf({ deploy: deployer({ started: true, summary: 's' }) })]);
        expect((await runDeploy({ deps, input })).started).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith('[deploy-ops] destination history write failed after accepted deploy');
      } finally { warn.mockRestore(); }
    });
  });
});

describe('waitForDeployOps', () => {
  /** Virtual clock: sleep advances time instantly. */
  function virtualClock(start = 1000) {
    const state = { t: start, sleeps: [] as number[] };
    const clock: WaitClock = { now: () => state.t, sleep: async ms => { state.sleeps.push(ms); state.t += ms; } };
    return { state, clock };
  }
  const st = (state: DeployOpsStatus['state']): DeployOpsStatus => ({ ...okStatus(), state });

  it('returns at once when the first poll already satisfies the condition', async () => {
    const { clock } = virtualClock();
    const status = vi.fn(async () => st('healthy'));
    const res = await waitForDeployOps({ status, clock }, { until: 'healthy', timeoutSeconds: 60 });
    expect(res).toEqual({ reached: true, waitedSeconds: 0, polls: 1, last: st('healthy') });
  });

  it('polls every 10s until healthy', async () => {
    const { clock, state } = virtualClock();
    const seq: DeployOpsStatus['state'][] = ['deploying', 'deploying', 'healthy'];
    const status = vi.fn(async () => st(seq.shift()!));
    const res = await waitForDeployOps({ status, clock }, { until: 'healthy', timeoutSeconds: 60 });
    expect(res).toMatchObject({ reached: true, polls: 3, waitedSeconds: 20 });
    expect(state.sleeps).toEqual([10_000, 10_000]);
  });

  it.each(['healthy', 'failing', 'stopped'] as const)('until finished stops on %s', async state => {
    const { clock } = virtualClock();
    const res = await waitForDeployOps({ status: async () => st(state), clock }, { until: 'finished', timeoutSeconds: 60 });
    expect(res).toMatchObject({ reached: true, polls: 1 });
  });

  it.each(['deploying', 'unknown'] as const)('until finished keeps waiting through %s', async state => {
    const { clock } = virtualClock();
    const res = await waitForDeployOps({ status: async () => st(state), clock }, { until: 'finished', timeoutSeconds: 10 });
    expect(res).toMatchObject({ reached: false, polls: 1, waitedSeconds: 10 });
  });

  it('until healthy does not treat failing as success', async () => {
    const { clock } = virtualClock();
    const res = await waitForDeployOps({ status: async () => st('failing'), clock }, { until: 'healthy', timeoutSeconds: 5 });
    expect(res.reached).toBe(false);
    expect(res.last.state).toBe('failing');
  });

  it('caps the last sleep at the remaining time and reports the timeout', async () => {
    const { clock, state } = virtualClock();
    const status = vi.fn(async () => st('deploying'));
    const res = await waitForDeployOps({ status, clock }, { until: 'healthy', timeoutSeconds: 25 });
    expect(state.sleeps).toEqual([10_000, 10_000, 5_000]);
    expect(res).toEqual({ reached: false, waitedSeconds: 25, polls: 3, last: st('deploying') });
  });

  it('skips the sleep when a poll ends exactly on the deadline', async () => {
    const { clock, state } = virtualClock();
    const status = vi.fn(async () => { state.t += 5000; return st('deploying'); });
    const res = await waitForDeployOps({ status, clock }, { until: 'healthy', timeoutSeconds: 5 });
    expect(state.sleeps).toEqual([]);
    expect(res).toMatchObject({ reached: false, polls: 1, waitedSeconds: 5 });
  });

  it('reports a timeout when a poll finishes after the deadline, even if it was healthy', async () => {
    const { clock, state } = virtualClock();
    const status = vi.fn(async () => { state.t += 6000; return st('healthy'); });
    const res = await waitForDeployOps({ status, clock }, { until: 'healthy', timeoutSeconds: 5 });
    expect(res.reached).toBe(false);
    expect(res.waitedSeconds).toBe(5);
    expect(res.last.state).toBe('healthy');
  });

  it('keeps the initial observation when no poll finished in time', async () => {
    const { clock } = virtualClock();
    const initial = { ...st('unknown'), summary: 'seed' };
    const res = await waitForDeployOps({ status: () => new Promise<never>(() => undefined), clock, initial }, { until: 'healthy', timeoutSeconds: 0.01 });
    expect(res).toEqual({ reached: false, waitedSeconds: 0, polls: 1, last: initial });
  });

  it('falls back to an unknown placeholder and aborts the in-flight status on timeout', async () => {
    const { clock } = virtualClock();
    let seen: AbortSignal | undefined;
    const status = (signal: AbortSignal) => { seen = signal; return new Promise<never>(() => undefined); };
    const res = await waitForDeployOps({ status, clock }, { until: 'healthy', timeoutSeconds: 0.01 });
    expect(res.reached).toBe(false);
    expect(res.last).toEqual({ platform: 'unknown', target: 'unknown', state: 'unknown', summary: 'No status received before timeout.', items: [], checkedAt: '' });
    expect(seen?.aborted).toBe(true);
  });

  it('uses the real monotonic clock and a 180s default timeout when none is injected', async () => {
    const res = await waitForDeployOps({ status: async () => st('healthy') }, { until: 'healthy' });
    expect(res).toMatchObject({ reached: true, polls: 1 });
    expect(res.waitedSeconds).toBeGreaterThanOrEqual(0);
    expect(res.waitedSeconds).toBeLessThan(5);
  });

  it('throws on a signal that is already aborted', async () => {
    const { clock } = virtualClock();
    const status = vi.fn(async () => st('healthy'));
    const ac = new AbortController(); ac.abort();
    expect((await catchErr(waitForDeployOps({ status, clock }, { until: 'healthy', signal: ac.signal }))).message).toBe('Deployment ops wait was aborted.');
    expect(status).not.toHaveBeenCalled();
  });

  it('throws when the signal aborts during an in-flight poll, aborting that poll', async () => {
    const { clock } = virtualClock();
    const ac = new AbortController();
    let seen: AbortSignal | undefined;
    const status = (signal: AbortSignal) => { seen = signal; queueMicrotask(() => ac.abort()); return new Promise<never>(() => undefined); };
    const err = await catchErr(waitForDeployOps({ status, clock }, { until: 'healthy', timeoutSeconds: 60, signal: ac.signal }));
    expect(err.message).toBe('Deployment ops wait was aborted.');
    expect(seen?.aborted).toBe(true);
  });

  it('throws when the signal aborts as the poll resolves', async () => {
    const { clock } = virtualClock();
    const ac = new AbortController();
    const status = vi.fn(async () => { ac.abort(); return st('healthy'); });
    expect((await catchErr(waitForDeployOps({ status, clock }, { until: 'healthy', timeoutSeconds: 60, signal: ac.signal }))).message).toBe('Deployment ops wait was aborted.');
  });

  it('throws when cancelled during the final sleep that reaches the deadline', async () => {
    const ac = new AbortController();
    let t = 0;
    const clock: WaitClock = { now: () => t, sleep: async ms => { t += ms; ac.abort(); } };
    const err = await catchErr(waitForDeployOps({ status: async () => st('deploying'), clock }, { until: 'healthy', timeoutSeconds: 5, signal: ac.signal }));
    expect(err.message).toBe('Deployment ops wait was aborted.');
  });

  it('removes its abort listener from the caller signal once a poll settles', async () => {
    const { clock } = virtualClock();
    const ac = new AbortController();
    const add = vi.spyOn(ac.signal, 'addEventListener');
    const remove = vi.spyOn(ac.signal, 'removeEventListener');
    await waitForDeployOps({ status: async () => st('healthy'), clock }, { until: 'healthy', timeoutSeconds: 60, signal: ac.signal });
    expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
  });

  it('propagates a refusal from the status reader', async () => {
    const { clock } = virtualClock();
    const boom = new ToolInputError({ message: 'status refused' });
    expect(await catchErr(waitForDeployOps({ status: async () => { throw boom; }, clock }, { until: 'healthy', timeoutSeconds: 60 }))).toBe(boom);
  });
});
