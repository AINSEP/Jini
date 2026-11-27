import { describe, expect, it, vi } from 'vitest';
import type { SurfaceCardSecretRun } from '@jini-ai/core/contracts/cards';
import { ToolInputError } from '@jini-ai/core';
import type { AgentToolDefinition, ToolExecutionContext } from '@jini-ai/core';
import { buildDeployOpsRegistrations } from '../ops-tools.js';
import { collectTypedDeploySecret } from '../ops-secret-card.js';
import { requireDeployPlatform } from '../ops-registry.js';
import { boundContext, runDeploy, waitForDeployOps } from '../ops-runner.js';
import { runListSecrets, runSetSecret, runUnsetSecret } from '../ops-secrets.js';
import type { DeployOpsRegistrationHost, DeployOpsRuntime, DeployOpsSecretCards, SecretConfirm, SetSecretInput } from '../ops-tool-contracts.js';
import type { DeployOpsDeployResult, DeployOpsModule, DeployOpsStatus, LoadedDeployOps } from '../ops-contracts.js';

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
  const catalog: AgentToolDefinition[] = Object.values(ids).filter(id => id !== ids.credentialVerify).map(name => ({ name, description: name, inputSchema: { type: 'object' }, sideEffects: 'mutates-durable-state', authorization: { permission: 'library.change' } }));
  const host = { catalog, metadata: {}, derivedRisk: new Map(catalog.map(c => [c.name, c.sideEffects])), domain: 'library-domain', catalogModule: 'library/operations.ts', permissions: { write: 'w', siteKey: 'k' }, permit: async () => undefined, approvals: { confirmFor: () => undefined }, cards: {} } as unknown as DeployOpsRegistrationHost;
  const call = (name: string, input: unknown, signal?: AbortSignal) => buildDeployOpsRegistrations({ deps, host }, {}).find(r => r.descriptor.id === name)!.handler(execution(input, signal));
  return { deps, events, call, platform, registry, host };
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

it("uses active workflow choices on each deploy and keeps only bounded, normalized output", async () => {
  const deploy = vi.fn<NonNullable<DeployOpsModule['deploy']>>(async () => ({
    platform: 'ignored', target: 'ignored', started: true, summary: 's'.repeat(2001), runId: 'job-2',
    sha: 'c42', machineIds: Array.from({ length: 33 }, (_, i) => `m-${i}`), image: 'release:2',
    url: 'http://library.test', debuggingToken: 'fixture',
  }));
  const f = wire({ deploy });
  f.deps.loadDeployWorkflowFiles = vi.fn<NonNullable<DeployOpsRuntime['loadDeployWorkflowFiles']>>(async ({ workspaceId }) => {
    expect(workspaceId).toBe('space');
    return ['release.yml', 'canary.yml'];
  });
  const history = vi.fn<NonNullable<typeof f.deps.publishHistoryStore>['recordSuccess']>();
  f.deps.publishHistoryStore = { recordSuccess: history };

  expect(await f.call(ids.deploy, { ...input, ref: 'v2', workflowFile: 'canary.yml', credentialLabel: 'key' })).toEqual({
    ...input, started: true, summary: 's'.repeat(2000), runId: 'job-2', sha: 'c42',
    machineIds: Array.from({ length: 32 }, (_, i) => `m-${i}`), image: 'release:2',
  });
  expect(deploy.mock.calls.map(([, args]) => args)).toEqual([
    { target: 'catalog', ref: 'v2', workflowFile: 'canary.yml', workflowFiles: ['release.yml', 'canary.yml'] },
  ]);
  expect(history.mock.calls).toEqual([[{ workspaceId: 'space', entry: {
    kind: 'deploy', target: 'library', projectName: 'catalog', url: '', reachable: false, status: 'started',
    publishedAt: '1970-01-01T00:00:00.000Z', triggeredBy: 'agent_tool',
  } }]]);
});

it("does not record an accepted deployment if the adapter returns an invalid run id", async () => {
  const f = wire({ deploy: async () => ({ ...accepted, runId: 'invalid run id' }) });
  const history = vi.fn<NonNullable<typeof f.deps.publishHistoryStore>['recordSuccess']>();
  f.deps.publishHistoryStore = { recordSuccess: history };
  const result = runDeploy({ deps: f.deps, input });
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toThrow("Deployment ops platform 'library' returned an invalid run id.");
  expect(history).not.toHaveBeenCalled();
});

it("distinguishes a switched-off platform from an unknown one and includes loader refusals", () => {
  const { platform, registry } = wire();
  const lookup = { registry: { ...registry, switchedOff: new Map([['archive', 'old-plugin']]), refusals: ['Failed to load report-plugin.'] } };
  expect(requireDeployPlatform({ ...lookup, id: 'library' })).toBe(platform);
  expect(() => requireDeployPlatform({ ...lookup, id: 'archive' })).toThrow("Deployment ops platform 'archive' is provided by plugin 'old-plugin', which is off; turn it on first.");
  expect(() => requireDeployPlatform({ ...lookup, id: 'typo' })).toThrow("Unknown deployment ops platform 'typo'. Choose: library, watcher. Failed to load report-plugin.");
  expect(() => requireDeployPlatform({ registry: { get: () => undefined, list: () => [], refusals: [] }, id: 'typo' })).toThrow("Unknown deployment ops platform 'typo'. Choose: (none).");
});

const endpoint = 'https://api.library.test/operation';

it("binds provider requests to the selected label and sends JSON only for a write with a body", async () => {
  const { deps, platform } = wire();
  const resolveTarget = vi.fn<DeployOpsRuntime['credentials']['resolveTarget']>(async ({ label, url }) => ({ label, url: new URL(url) }));
  const request = vi.fn<DeployOpsRuntime['credentials']['request']>()
    .mockResolvedValueOnce({ executed: true, headers: {}, status: 201, bodyText: '{"job":"j2"}', bodyTruncated: false })
    .mockResolvedValueOnce({ executed: true, headers: {}, status: 204, bodyText: '', bodyTruncated: false })
    .mockResolvedValueOnce({ executed: true, headers: {}, status: 200, bodyText: '{"job":"j2"}', bodyTruncated: true });
  const signal = new AbortController().signal;
  const ctx = await boundContext({ deps: { ...deps, credentials: { ...deps.credentials, resolveTarget, request } }, platform, explicit: 'key' }, { signal, allowDelete: true });
  expect(ctx.nowIso()).toBe('1970-01-01T00:00:00.000Z');
  expect(() => ctx.fail('adapter refusal')).toThrow('adapter refusal');
  expect(await ctx.send({ method: 'POST', url: endpoint, body: { ref: 'v2' } })).toEqual({ status: 201, text: '{"job":"j2"}', json: { job: 'j2' }, truncated: false });
  expect(await ctx.send({ method: 'DELETE', url: endpoint })).toEqual({ status: 204, text: '', truncated: false });
  expect(await ctx.get(endpoint)).toEqual({ status: 200, text: '{"job":"j2"}', truncated: true });
  const target = { workspaceId: 'space', label: 'key', url: endpoint };
  expect(resolveTarget.mock.calls).toEqual([[target, {}], [target, {}], [target, {}]]);
  expect(request.mock.calls).toEqual([
    [{ ...target, method: 'POST', maxResponseBytes: 256_000 }, { signal, headers: { 'content-type': 'application/json', accept: 'application/json' }, body: '{"ref":"v2"}' }],
    [{ ...target, method: 'DELETE', maxResponseBytes: 256_000 }, { signal, headers: { accept: 'application/json' } }],
    [{ ...target, method: 'GET', maxResponseBytes: 256_000 }, { signal }],
  ]);
});

it.each([
  { method: 'GET', category: 'transport', message: "Could not reach deployment ops host 'api.library.test' using credential 'key'. Retry the check." },
  { method: 'POST', category: 'transport', message: "Lost the connection to deployment ops host 'api.library.test' during a POST; it may or may not have been accepted. Check lib_state before retrying." },
  { method: 'GET', category: 'egress-refused', message: "Deployment ops host 'api.library.test' was refused by outbound HTTP policy. Use a public HTTPS endpoint allowed by the saved credential." },
  { method: 'GET', category: 'validation', message: "Credential 'key' changed or no longer allows host 'api.library.test'. Check its saved hosts or choose another credentialLabel." },
  { method: 'GET', category: 'not-found', message: "Credential 'key' changed or no longer allows host 'api.library.test'. Check its saved hosts or choose another credentialLabel." },
] as const)("maps $category during $method to a safe caller-facing diagnostic", async ({ method, category, message }) => {
  const { deps, platform } = wire();
  const cause = new Error('raw transport fixture detail');
  const credentials = { ...deps.credentials,
    request: vi.fn<DeployOpsRuntime['credentials']['request']>().mockRejectedValue(cause),
    classifyError: vi.fn<DeployOpsRuntime['credentials']['classifyError']>(() => {
      if (category === 'transport') return { category, error: cause };
      if (category === 'egress-refused') return { category, error: cause, callerSafeMessage: 'host refused', callerSafeError: new Error('host refused') };
      return { category, error: cause, callerSafeMessage: 'credential refused' };
    }),
  };
  const ctx = await boundContext({ deps: { ...deps, credentials }, platform });
  const result = method === 'GET' ? ctx.get(endpoint) : ctx.send({ method, url: endpoint });
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toMatchObject({ message });
  expect(credentials.classifyError.mock.calls).toEqual([[{ error: cause }, {}]]);
});

it("returns the host's credential setup diagnostic by identity through the registered handler", async () => {
  const f = wire();
  const credentialSetup = { setupToolId: 'link_library', hint: 'Connect the library account.' };
  const setupRequired = vi.fn(() => ({ credentialSetup, message: 'Connect first' }));
  f.deps.credentials.list = async () => [{ label: 'other', allowedOrigins: ['https://other.test'] }];
  f.deps.recovery.setupRequired = setupRequired;
  const result = await f.call(ids.status, input);
  expect(result).toEqual({ executed: false, credentialSetup });
  expect(result).toHaveProperty('credentialSetup');
  expect((result as { credentialSetup: unknown }).credentialSetup).toBe(credentialSetup);
  expect(setupRequired.mock.calls).toEqual([[{ label: 'library', baseUrl: 'https://api.library.test' }]]);
  expect(f.events).toEqual([]);
});

it.each([
  { id: ids.logs, args: { limit: 501 }, message: 'limit must be an integer from 1 to 500.' },
  { id: ids.wait, args: { until: 'finished', timeoutSeconds: 9 }, message: 'timeoutSeconds must be an integer from 10 to 300.' },
  { id: ids.wait, args: { until: 'staged' }, message: "until must be 'healthy' or 'finished'." },
  { id: ids.status, args: { target: ' ' }, message: 'target must be a non-empty string of at most 200 characters.' },
  { id: ids.deploy, args: { force: true }, message: "Unexpected deployment ops input 'force'." },
  { id: ids.setSecret, args: { name: 'KEY', source: null }, message: "source must be {kind:'typed'}, {kind:'site-key'} or {kind:'secret', name}." },
  { id: ids.setSecret, args: { name: 'KEY', source: { kind: 'typed', value: 'not a human answer' } }, message: "source must be {kind:'typed'}, {kind:'site-key'} or {kind:'secret', name}." },
  { id: ids.setSecret, args: { name: 'KEY', source: { kind: 'site-key' }, dryRun: 'true' }, message: 'dryRun must be a boolean.' },
])("rejects direct handler input for $id ($message) before loading adapters", async ({ id, args, message }) => {
  const f = wire();
  const load = vi.fn(f.deps.loadDeployOps);
  f.deps.loadDeployOps = load;
  const result = f.call(id, { ...input, ...args });
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toMatchObject({ message });
  expect(load).not.toHaveBeenCalled();
});

const observation = (state: DeployOpsStatus['state']): DeployOpsStatus => ({
  ...input, state, summary: `state=${state}`, items: [], checkedAt: '2026-11-09T00:00:00Z',
});

it("polls immediately, waits in ten-second intervals and returns the final failing deployment", async () => {
  let ms = 25;
  const sleep = vi.fn(async (duration: number) => { ms += duration; });
  const status = vi.fn<(signal: AbortSignal) => Promise<DeployOpsStatus>>()
    .mockResolvedValueOnce(observation('deploying')).mockResolvedValueOnce(observation('failing'));
  const signal = new AbortController().signal;
  expect(await waitForDeployOps({ deps: { status, clock: { now: () => ms, sleep } }, until: 'finished' },
    { timeoutSeconds: 30, signal })).toEqual({ reached: true, waitedSeconds: 10, polls: 2, last: observation('failing') });
  expect(sleep.mock.calls).toEqual([[10_000, signal]]);
  expect(status).toHaveBeenCalledTimes(2);
});

it("aborts a hung poll at its deadline and keeps the last known observation", async () => {
  vi.useFakeTimers();
  try {
    const started = Date.now();
    const sleep = vi.fn((duration: number) => new Promise<void>(resolve => { setTimeout(resolve, duration); }));
    const status = vi.fn<(signal: AbortSignal) => Promise<DeployOpsStatus>>()
      .mockResolvedValueOnce(observation('deploying')).mockImplementationOnce(() => new Promise(() => {}));
    const result = waitForDeployOps({ deps: { status, clock: { now: () => Date.now() - started, sleep } }, until: 'healthy' }, { timeoutSeconds: 12 });
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(result).resolves.toEqual({ reached: false, waitedSeconds: 12, polls: 2, last: observation('deploying') });
    expect(status.mock.calls.map(([signal]) => signal.aborted)).toEqual([false, true]);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

const secretTarget = { ...input, name: 'RELEASE_KEY' };
const fromSite: SetSecretInput = { ...secretTarget, source: { kind: 'site-key' } };

function secretHost({ entries = [], read = true, truncated = false }: {
  entries?: Array<{ name: string; value: string; digest?: string; updatedAt?: string }>; read?: boolean; truncated?: boolean;
} = {}) {
  const inventory = new Map(entries.map(({ name, ...stored }) => [name, stored]));
  const operations: string[] = [];
  const checkTarget = (target: string) => { if (target !== 'catalog') throw new Error(`Unexpected target ${target}`); };
  const setSecret = vi.fn<NonNullable<DeployOpsModule['setSecret']>>(async (_, { target, name, value }) => {
    checkTarget(target);
    operations.push('write');
    inventory.set(name, { value, digest: 'next-digest' });
    return { version: 42 };
  });
  const unsetSecret = vi.fn<NonNullable<DeployOpsModule['unsetSecret']>>(async (_, { target, name }) => {
    checkTarget(target);
    if (!inventory.delete(name)) throw new Error(`Unexpected delete of ${name}`);
    return { version: 'deleted-9' };
  });
  const listSecrets = vi.fn<NonNullable<DeployOpsModule['listSecrets']>>(async (_, { target }) => {
    checkTarget(target);
    return { secrets: Array.from(inventory, ([name, fields]) => ({ name, ...fields })), truncated };
  });
  const readSecret = vi.fn<NonNullable<DeployOpsModule['readSecret']>>(async (_, { target, name }) => {
    checkTarget(target);
    const entry = inventory.get(name);
    return entry === undefined ? { absent: true } : { value: entry.value };
  });
  const f = wire({ secretCapabilities: { appliesOn: 'next-deploy', supportsStaging: true }, listSecrets, setSecret, unsetSecret,
    ...(read ? { readSecret } : {}) });
  f.deps.siteKey.read = () => 'site-key-fixture';
  const fingerprint = vi.fn<DeployOpsRuntime['siteKey']['fingerprint']>(() => ({ fingerprint: 'fixture-id', fingerprintKind: 'sha256' }));
  f.deps.siteKey.fingerprint = fingerprint;
  return { ...f, setSecret, unsetSecret, listSecrets, readSecret, inventory, operations, fingerprint };
}

it("lists at most 500 entries, strips values, and advertises when writes will take effect", async () => {
  const f = secretHost({ entries: [
    { name: 'R'.repeat(129), value: 'private fixture', digest: 'd'.repeat(201), updatedAt: 't'.repeat(65) },
    ...Array.from({ length: 500 }, (_, i) => ({ name: `KEY_${i}`, value: 'not metadata' })),
  ] });
  const inventory = await f.call(ids.listSecrets, input);
  expect(inventory).toEqual({
    ...input, truncated: true, deployNeeded: true, appliesOn: 'next-deploy', supportsStaging: true,
    secrets: [{ name: 'R'.repeat(128), digest: 'd'.repeat(200), updatedAt: 't'.repeat(64) },
      ...Array.from({ length: 499 }, (_, i) => ({ name: `KEY_${i}` }))],
  });
  expect(f.listSecrets.mock.calls.map(([, target]) => target)).toEqual([{ target: 'catalog' }]);
});

it("rejects an invalid secret inventory rather than presenting it as empty", async () => {
  const f = secretHost();
  f.listSecrets.mockResolvedValueOnce({ secrets: [{ name: '' }] });
  const result = runListSecrets({ deps: f.deps, input });
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toThrow("Deployment ops platform 'library' returned an invalid secret list.");
});

it("requires the site-key permission before reading key material", async () => {
  const f = secretHost();
  const denied = new Error('site key access denied');
  const read = vi.fn(f.deps.siteKey.read);
  f.deps.siteKey.read = read;
  const permissions: string[] = [];
  f.host.permit = async ({ permission }) => {
    permissions.push(permission);
    if (permission === f.host.permissions.siteKey) throw denied;
  };
  await expect(f.call(ids.setSecret, fromSite)).rejects.toBe(denied);
  expect(permissions).toEqual(['library.change', 'k']);
  expect(read).not.toHaveBeenCalled();
  expect(f.setSecret).not.toHaveBeenCalled();
});

it("copies a secret on the same target, fingerprints the copied bytes and skips an identical second write", async () => {
  const f = secretHost({ entries: [{ name: 'OLD_KEY', value: '  fixture\n', digest: 'old-digest' }] });
  const copy = { ...secretTarget, source: { kind: 'secret', name: 'OLD_KEY' } };
  const expected = {
    ...secretTarget, source: copy.source, appliesOn: 'next-deploy', supportsStaging: true,
    fingerprint: 'fixture-id', fingerprintKind: 'sha256',
  };
  expect(await f.call(ids.setSecret, copy)).toEqual({
    ...expected, changed: true, comparison: 'absent', deployNeeded: true, version: '42',
    summary: "Set 'RELEASE_KEY' on 'catalog' from secret OLD_KEY. The running app keeps the old environment until the next deploy of 'catalog' (lib_launch).",
  });
  expect(f.inventory.get('RELEASE_KEY')).toEqual({ value: '  fixture\n', digest: 'next-digest' });
  expect(await f.call(ids.setSecret, copy)).toEqual({
    ...expected, changed: false, comparison: 'same', deployNeeded: false,
    summary: "'RELEASE_KEY' on 'catalog' already holds secret OLD_KEY; nothing was written.",
  });
  expect(f.fingerprint.mock.calls).toEqual([[{ value: '  fixture\n' }, {}], [{ value: '  fixture\n' }, {}]]);
  expect(f.setSecret.mock.calls.map(([, args]) => args)).toEqual([{ target: 'catalog', name: 'RELEASE_KEY', value: '  fixture\n' }]);
  expect(f.readSecret.mock.calls.map(([, args]) => args)).toEqual([
    { target: 'catalog', name: 'OLD_KEY' }, { target: 'catalog', name: 'RELEASE_KEY' },
    { target: 'catalog', name: 'OLD_KEY' }, { target: 'catalog', name: 'RELEASE_KEY' },
  ]);
});

it.each([
  { scenario: 'missing source', canRead: true, name: 'RELEASE_KEY', source: { kind: 'secret', name: 'OLD_KEY' }, message: "Secret 'OLD_KEY' is not set on 'catalog', so there is nothing to copy. List the secrets with lib_names." },
  { scenario: 'self copy', canRead: true, name: 'RELEASE_KEY', source: { kind: 'secret', name: 'RELEASE_KEY' }, message: 'source.name must differ from name; a secret cannot be copied onto itself.' },
  { scenario: 'write-only vendor', canRead: false, name: 'RELEASE_KEY', source: { kind: 'secret', name: 'OLD_KEY' }, message: "Deployment ops platform 'library' cannot read secret values, so it cannot copy one secret to another. Use source kind 'site-key'." },
  { scenario: 'invalid destination', canRead: true, name: '9KEY', source: { kind: 'site-key' }, message: 'name must be an environment variable name (letters, digits and underscores, not starting with a digit, at most 128 characters).' },
  { scenario: 'invalid source name', canRead: true, name: 'RELEASE_KEY', source: { kind: 'secret', name: 'INVALID-NAME' }, message: 'source.name must be an environment variable name (letters, digits and underscores, not starting with a digit, at most 128 characters).' },
] as const)("does not write an invalid secret request ($scenario)", async ({ canRead, name, source, message }) => {
  const f = secretHost({ read: canRead });
  const result = runSetSecret({ deps: f.deps, input: { ...secretTarget, name, source } });
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toMatchObject({ message });
  expect(f.setSecret).not.toHaveBeenCalled();
});

it.each([undefined, '   ', 'x'.repeat(8193)])("rejects a missing, blank, or over-limit secure-field value (case %#)", async typedValue => {
  const f = secretHost();
  const result = runSetSecret({ deps: f.deps, input: { ...secretTarget, source: { kind: 'typed' } } }, { typedValue });
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toThrow('The secure form requires a non-blank secret of at most 8192 characters.');
  expect(f.setSecret).not.toHaveBeenCalled();
});

it("reports an unavailable site key without inspecting the destination", async () => {
  const f = secretHost();
  f.deps.siteKey.read = () => undefined;
  const list = vi.fn(f.deps.credentials.list);
  f.deps.credentials.list = list;
  const result = runSetSecret({ deps: f.deps, input: fromSite });
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toMatchObject({ message: 'k' });
  expect(list).not.toHaveBeenCalled();
  expect(f.setSecret).not.toHaveBeenCalled();
});

it.each([
  { entries: [], read: false, truncated: false, comparison: 'absent', verb: 'created' },
  { entries: [], read: false, truncated: true, comparison: 'unknown', verb: 'replaced' },
  { entries: [{ name: 'RELEASE_KEY', value: 'old-value' }], read: true, truncated: false, comparison: 'different', verb: 'replaced' },
])("reports what a dry run would do with a $comparison destination without writing", async ({ entries, read, truncated, comparison, verb }) => {
  const f = secretHost({ entries, read, truncated });
  const confirm = vi.fn<SecretConfirm>();
  expect(await runSetSecret({ deps: f.deps, input: { ...fromSite, dryRun: true } }, { confirm })).toEqual({
    ...fromSite, appliesOn: 'next-deploy', supportsStaging: true, fingerprint: 'fixture-id', fingerprintKind: 'sha256',
    changed: false, comparison, dryRun: true, deployNeeded: false,
    summary: `Dry run: 'RELEASE_KEY' would be ${verb} from this site's key. Nothing was written.`,
  });
  expect(f.setSecret).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
});

it("refuses an overwrite without confirmation and writes only after an affirmative answer", async () => {
  const f = secretHost({ entries: [{ name: 'RELEASE_KEY', value: 'older', digest: 'old-digest' }] });
  f.readSecret.mockRejectedValue(new Error('no read permission'));
  const withoutConfirm = runSetSecret({ deps: f.deps, input: fromSite });
  await expect(withoutConfirm).rejects.toBeInstanceOf(ToolInputError);
  await expect(withoutConfirm).rejects.toThrow("Changing existing secret 'RELEASE_KEY' needs a human confirmation, and this call has no way to ask. Nothing was changed.");
  const confirm = vi.fn<SecretConfirm>()
    .mockResolvedValueOnce({ confirmed: false, result: { cancelled: true, reason: 'expired', note: 'Try again' } })
    .mockImplementationOnce(async () => { f.operations.push('confirmed'); return { confirmed: true }; });
  expect(await runSetSecret({ deps: f.deps, input: fromSite }, { confirm })).toMatchObject({
    changed: false, comparison: 'unknown', deployNeeded: false, cancelled: true, reason: 'expired', note: 'Try again',
  });
  expect(f.inventory.get('RELEASE_KEY')).toEqual({ value: 'older', digest: 'old-digest' });
  expect(await runSetSecret({ deps: f.deps, input: fromSite }, { confirm })).toMatchObject({ changed: true, comparison: 'unknown', version: '42' });
  expect(f.inventory.get('RELEASE_KEY')).toEqual({ value: 'site-key-fixture', digest: 'next-digest' });
  expect(confirm.mock.calls).toEqual(Array(2).fill([{
    action: 'overwrite', ...secretTarget, source: "this site's key", comparison: 'unknown', appliesOn: 'next-deploy',
  }]));
  expect(f.operations).toEqual(['confirmed', 'write']);
});

it("does not overwrite if cancellation arrives while awaiting approval", async () => {
  const f = secretHost({ entries: [{ name: 'RELEASE_KEY', value: 'old-value' }] });
  const abort = new AbortController();
  const result = runSetSecret({ deps: f.deps, input: fromSite }, {
    signal: abort.signal, confirm: async () => { abort.abort(); return { confirmed: true }; },
  });
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toThrow('Deployment ops wait was aborted.');
  expect(f.inventory.get('RELEASE_KEY')).toEqual({ value: 'old-value' });
  expect(f.setSecret).not.toHaveBeenCalled();
});

it("does not ask or delete when a complete inventory says the key is absent", async () => {
  const f = secretHost({ entries: [{ name: 'UNRELATED', value: 'keep', digest: 'actual' }] });
  const confirm = vi.fn<SecretConfirm>();
  expect(await runUnsetSecret({ deps: f.deps, input: secretTarget }, { confirm })).toEqual({
    ...secretTarget, appliesOn: 'next-deploy', supportsStaging: true, deployNeeded: false, removed: false,
    summary: "'RELEASE_KEY' is not set on 'catalog'; nothing was removed.",
  });
  expect(confirm).not.toHaveBeenCalled();
  expect(f.unsetSecret).not.toHaveBeenCalled();
});

it.each([
  { entries: [], truncated: true },
  { entries: [{ name: 'RELEASE_KEY', value: 'no version' }], truncated: false },
])("refuses to ask for removal of a secret without an identifiable version (truncated=$truncated)", async ({ entries, truncated }) => {
  const f = secretHost({ entries, truncated });
  const confirm = vi.fn<SecretConfirm>();
  const result = runUnsetSecret({ deps: f.deps, input: secretTarget }, { confirm });
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toThrow('lib_remove: the provider cannot identify the current secret version safely. Remove it in the provider console; nothing was deleted.');
  expect(confirm).not.toHaveBeenCalled();
  expect(f.unsetSecret).not.toHaveBeenCalled();
});

it("rechecks the approved version and preserves a secret replaced during confirmation", async () => {
  const f = secretHost({ entries: [{ name: 'RELEASE_KEY', value: 'old', digest: 'v1' }] });
  const confirm = vi.fn<SecretConfirm>(async () => {
    f.inventory.set('RELEASE_KEY', { value: 'replacement', digest: 'v2' });
    return { confirmed: true };
  });
  const result = runUnsetSecret({ deps: f.deps, input: secretTarget }, { confirm });
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toThrow('lib_remove: target changed while confirmation was open. Request a new confirmation; nothing was deleted.');
  expect(confirm.mock.calls).toEqual([[{ action: 'remove', ...secretTarget, appliesOn: 'next-deploy' }]]);
  expect(f.unsetSecret).not.toHaveBeenCalled();
  expect(f.inventory.get('RELEASE_KEY')).toEqual({ value: 'replacement', digest: 'v2' });
});

it("keeps a declined secret and removes only the approved, unchanged key on retry", async () => {
  const f = secretHost({ entries: [
    { name: 'RELEASE_KEY', value: 'old', updatedAt: '2026-11-09T00:00:00Z' },
    { name: 'KEEP_KEY', value: 'keep', digest: 'retained' },
  ] });
  const confirm = vi.fn<SecretConfirm>()
    .mockResolvedValueOnce({ confirmed: false, result: { cancelled: true, note: 'Declined' } })
    .mockResolvedValueOnce({ confirmed: true });
  f.host.approvals.confirmFor = () => confirm;
  expect(await f.call(ids.unsetSecret, secretTarget)).toMatchObject({ cancelled: true, note: 'Declined', removed: false, deployNeeded: false });
  expect(f.inventory.get('RELEASE_KEY')).toEqual({ value: 'old', updatedAt: '2026-11-09T00:00:00Z' });
  expect(await f.call(ids.unsetSecret, secretTarget)).toEqual({
    ...secretTarget, removed: true, version: 'deleted-9', deployNeeded: true, appliesOn: 'next-deploy', supportsStaging: true,
    summary: "Removed 'RELEASE_KEY' from 'catalog'. The running app keeps the old environment until the next deploy of 'catalog' (lib_launch).",
  });
  expect(await f.call(ids.listSecrets, input)).toEqual({
    ...input, secrets: [{ name: 'KEEP_KEY', digest: 'retained' }], truncated: false,
    deployNeeded: true, appliesOn: 'next-deploy', supportsStaging: true,
  });
  expect(f.unsetSecret.mock.calls.map(([, args]) => args)).toEqual([{ target: 'catalog', name: 'RELEASE_KEY' }]);
});

const humanValue = '  candidate value\n';
const cardInput: SetSecretInput = { ...secretTarget, source: { kind: 'typed' } };
function humanCard({ state = 'submitted', beforeSave }: {
  state?: 'submitted' | 'cancelled' | 'blank'; beforeSave?: () => void;
} = {}) {
  const outcomes: unknown[] = [];
  const definitions: unknown[] = [];
  const surfaceExchanges: NonNullable<DeployOpsSecretCards['surfaceExchanges']> = { open: vi.fn() };
  const form = vi.fn<DeployOpsSecretCards['form']>(({ title }) => ({
    title, submitLabel: 'Send', fields: [{ kind: 'string', name: 'value', label: 'Value', secret: true, required: true }],
  }));
  const cards: DeployOpsSecretCards = {
    surfaceExchanges, askThenReport: vi.fn(), uriHost: 'fixture', defaultLocale: 'en', noEmitter: 'No secure form channel',
    locale: async () => 'fr',
    form,
    text: ({ id, locale }) => `${locale}:${id}`,
    defineSecretCardTool: (spec, options) => ({
      toolId: spec.toolId,
      secretFieldNames: () => ['value'],
      handler: deps => async ctx => {
        if (deps.surfaceExchanges !== surfaceExchanges) throw new Error('Wrong exchange store');
        definitions.push({ toolId: spec.toolId, uriHost: options?.uriHost });
        const prep = await spec.prepare({ ctx });
        const drawn = spec.form({ prep });
        const field = drawn.fields.find(f => f.name === 'value');
        if (field?.secret !== true) throw new Error('Expected a private value field');
        const save = async (): Promise<SurfaceCardSecretRun<Awaited<ReturnType<typeof spec.save>>>> => {
          if (state !== 'submitted') return { status: state };
          beforeSave?.();
          try { return { status: 'saved', saved: await spec.save({ prep, signal: ctx.signal, values: { [field.name]: humanValue } }) }; }
          catch (error) { return { status: 'failed', safeMessage: options?.safeError?.(error) ?? String(error) }; }
        };
        const run = await save();
        outcomes.push({ run: run.status, surface: spec.outcome({ prep, run }),
          ...(run.status === 'failed' ? { safeMessage: run.safeMessage } : {}) });
        return spec.result({ prep, run });
      },
    }),
  };
  return { cards, form, definitions, outcomes };
}

it("submits untrimmed secure card bytes only after rechecking permission and reports a localized success", async () => {
  const f = secretHost();
  const card = humanCard();
  f.host.cards = card.cards;
  f.host.permit = async ({ permission }) => { f.operations.push(permission); };
  expect(await f.call(ids.setSecret, cardInput)).toEqual({
    ...cardInput, changed: true, comparison: 'absent', fingerprint: 'fixture-id', fingerprintKind: 'sha256',
    deployNeeded: true, appliesOn: 'next-deploy', supportsStaging: true, version: '42',
    summary: "Set 'RELEASE_KEY' on 'catalog' from the secure card. The running app keeps the old environment until the next deploy of 'catalog' (lib_launch).",
  });
  expect(f.inventory.get('RELEASE_KEY')).toEqual({ value: humanValue, digest: 'next-digest' });
  expect(f.operations).toEqual(['library.change', 'w', 'write']);
  expect(card.definitions).toEqual([{ toolId: ids.setSecret, uriHost: 'fixture' }]);
  expect(card.form.mock.calls).toEqual([[{ locale: 'fr', title: 'RELEASE_KEY · catalog' }]]);
  expect(card.outcomes).toEqual([{ run: 'saved', surface: { title: 'RELEASE_KEY · catalog', state: 'success', message: 'fr:savedTitle' } }]);
});

it.each([
  { state: 'cancelled', result: { changed: false, cancelled: true }, surface: undefined },
  { state: 'blank', result: { changed: false, message: 'fr:storage' }, surface: { title: 'RELEASE_KEY · catalog', state: 'failure', message: 'fr:storage' } },
] as const)("does not write a secret after a $state card answer", async ({ state, result, surface }) => {
  const f = secretHost();
  const card = humanCard({ state });
  const permit = vi.fn<() => Promise<void>>();
  expect(await collectTypedDeploySecret({ ctx: execution(cardInput), deps: f.deps, cards: card.cards, input: cardInput, permit })).toEqual(result);
  expect(card.outcomes).toEqual([{ run: state, surface }]);
  expect(permit).not.toHaveBeenCalled();
  expect(f.setSecret).not.toHaveBeenCalled();
});

it("uses localized failure text even when the vendor exception echoes the submitted secret", async () => {
  const f = secretHost();
  const card = humanCard();
  f.setSecret.mockRejectedValueOnce(new Error(humanValue));
  const permit = vi.fn(async () => {});
  expect(await collectTypedDeploySecret({ ctx: execution(cardInput), deps: f.deps, cards: card.cards, input: cardInput, permit })).toEqual({
    changed: false, message: 'fr:storage',
  });
  expect(card.outcomes).toEqual([{ run: 'failed', safeMessage: 'fr:storage',
    surface: { title: 'RELEASE_KEY · catalog', state: 'failure', message: 'fr:storage' } }]);
  expect(f.setSecret.mock.calls.map(([, args]) => args)).toEqual([{ target: 'catalog', name: 'RELEASE_KEY', value: humanValue }]);
  expect(f.inventory.has('RELEASE_KEY')).toBe(false);
});

it("shows credential recovery instead of a second outcome card when the credential disappears after prepare", async () => {
  const f = secretHost();
  const diagnostic = { setupToolId: 'link_library', hint: 'Credential was removed' };
  const setupRequired = vi.fn(() => ({ message: 'Reconnect', credentialSetup: diagnostic }));
  f.deps.recovery.setupRequired = setupRequired;
  const card = humanCard({ beforeSave: () => { f.deps.credentials.list = async () => []; } });
  const result = await collectTypedDeploySecret({ ctx: execution(cardInput), deps: f.deps, cards: card.cards, input: cardInput, permit: async () => {} });
  expect(result).toEqual({ executed: false, credentialSetup: diagnostic });
  expect((result as { credentialSetup: unknown }).credentialSetup).toBe(diagnostic);
  expect(card.outcomes).toEqual([{ run: 'saved', surface: undefined }]);
  expect(setupRequired.mock.calls).toEqual([[{ label: 'library', baseUrl: 'https://api.library.test' }]]);
  expect(f.setSecret).not.toHaveBeenCalled();
});

it("refuses secure collection without a surface exchange before reading the platform or opening a form", async () => {
  const f = secretHost();
  const card = humanCard();
  const load = vi.fn(f.deps.loadDeployOps);
  f.deps.loadDeployOps = load;
  const permit = vi.fn<() => Promise<void>>();
  const result = collectTypedDeploySecret({
    ctx: execution(cardInput), deps: f.deps, cards: { ...card.cards, surfaceExchanges: undefined }, input: cardInput, permit,
  });
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toThrow('No secure form channel');
  expect(load).not.toHaveBeenCalled();
  expect(card.form).not.toHaveBeenCalled();
  expect(permit).not.toHaveBeenCalled();
});

it("forwards exact list and log selectors, with a default limit only when omitted", async () => {
  const listTargets = vi.fn<NonNullable<DeployOpsModule['listTargets']>>(async () => ({ platform: 'library', targets: [{ id: 'catalog', name: 'Catalog' }] }));
  const logs = vi.fn<DeployOpsModule['logs']>(async (_, { target, limit }) => ({
    platform: 'library', target, lines: [{ message: `requested ${limit}` }], truncated: false,
  }));
  const f = wire({ listTargets, logs });
  expect(await f.call(ids.listTargets, { platform: 'library', org: 'books', credentialLabel: 'key' })).toEqual({
    platform: 'library', targets: [{ id: 'catalog', name: 'Catalog' }],
  });
  expect(await f.call(ids.logs, { ...input, runId: 'job-2', branch: 'release', limit: 500 })).toEqual({
    ...input, lines: [{ message: 'requested 500' }], truncated: false,
  });
  expect(await f.call(ids.logs, input)).toEqual({ ...input, lines: [{ message: 'requested 100' }], truncated: false });
  expect(listTargets.mock.calls.map(([, args]) => args)).toEqual([{ org: 'books' }]);
  expect(logs.mock.calls.map(([, args]) => args)).toEqual([
    { ...input, runId: 'job-2', branch: 'release', limit: 500, credentialLabel: undefined },
    { ...input, runId: undefined, branch: undefined, limit: 100, credentialLabel: undefined },
  ]);
  await expect(wire().call(ids.listTargets, { platform: 'library' })).rejects.toThrow(
    "Deployment ops platform 'library' does not support listing targets. Supply a target for lib_state.",
  );
});

it("aborts a status poll immediately on caller cancellation without scheduling another poll", async () => {
  vi.useFakeTimers();
  try {
    const ctrl = new AbortController();
    const sleep = vi.fn(async () => {});
    const status = vi.fn<(signal: AbortSignal) => Promise<DeployOpsStatus>>(() => new Promise(() => {}));
    const running = waitForDeployOps({ deps: { status, clock: { now: () => 0, sleep } }, until: 'healthy' },
      { signal: ctrl.signal, timeoutSeconds: 12 });
    expect(status).toHaveBeenCalledOnce();
    ctrl.abort();
    await expect(running).rejects.toBeInstanceOf(ToolInputError);
    await expect(running).rejects.toThrow('Deployment ops wait was aborted.');
    expect(status.mock.calls[0]![0].aborted).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it("honors cancellation and caps delays on the real default timer-backed module clock", async () => {
  vi.useFakeTimers();
  try {
    const f = wire();
    const controller = new AbortController();
    const ctx = await boundContext({ deps: f.deps, platform: f.platform }, { signal: controller.signal });
    let finished = false;
    const sleep = ctx.sleep(50_000).then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await sleep;
    expect(finished).toBe(true);
    const pending = ctx.sleep(1000);
    controller.abort();
    await expect(pending).rejects.toThrow('Deployment ops wait was aborted.');
    await expect(ctx.sleep(1000)).rejects.toThrow('Deployment ops wait was aborted.');
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it.each(["target lookup", "request success", "request failure"] as const)(
  "reports cancellation instead of continuing after %s",
  async phase => {
    const { deps, platform } = wire();
    const controller = new AbortController();
    const resolveTarget = vi.fn<DeployOpsRuntime["credentials"]["resolveTarget"]>(async ({ label, url }) => {
      if (phase === "target lookup") controller.abort();
      return { label, url: new URL(url) };
    });
    const request = vi.fn<DeployOpsRuntime["credentials"]["request"]>(async () => {
      controller.abort();
      if (phase === "request failure") throw new Error("provider details should not replace cancellation");
      return { executed: true, status: 200, headers: {}, bodyText: '{"accepted":true}', bodyTruncated: false };
    });
    const ctx = await boundContext({ deps: { ...deps, credentials: { ...deps.credentials, resolveTarget, request } }, platform }, { signal: controller.signal });
    const result = ctx.get(endpoint);
    await expect(result).rejects.toBeInstanceOf(ToolInputError);
    await expect(result).rejects.toThrow("Deployment ops wait was aborted.");
    const target = { workspaceId: "space", label: "key", url: endpoint };
    expect(resolveTarget.mock.calls).toEqual([[target, {}]]);
    expect(request.mock.calls).toEqual(phase === "target lookup" ? [] : [
      [{ ...target, method: "GET", maxResponseBytes: 256_000 }, { signal: controller.signal }],
    ]);
  },
);

it("uses only the remaining deadline for the last sleep and does not count failing as healthy", async () => {
  let now = 4_000;
  const sleep = vi.fn(async (ms: number) => { now += ms; });
  const last: DeployOpsStatus = {
    platform: "library", target: "catalog", checkedAt: "2026-11-09T00:00:01Z", state: "failing",
    summary: "Latest health check failed", items: [],
  };
  const status = vi.fn(async () => last);
  const signal = new AbortController().signal;
  await expect(waitForDeployOps({ deps: { status, clock: { now: () => now, sleep } }, until: "healthy" }, {
    timeoutSeconds: 3, signal,
  })).resolves.toEqual({ reached: false, waitedSeconds: 3, polls: 1, last });
  expect(sleep.mock.calls).toEqual([[3_000, signal]]);
  expect(status).toHaveBeenCalledOnce();
});

it("refuses credential mismatches at the target resolver without dispatching a request", async () => {
  const f = wire();
  const cause = new Error('private vault details');
  const resolveTarget = vi.fn<DeployOpsRuntime['credentials']['resolveTarget']>().mockRejectedValue(cause);
  const request = vi.fn<DeployOpsRuntime['credentials']['request']>();
  const classifyError = vi.fn<DeployOpsRuntime['credentials']['classifyError']>()
    .mockReturnValueOnce({ category: 'validation', error: cause, callerSafeMessage: 'host not allowed' })
    .mockReturnValueOnce({ category: 'not-found', error: cause, callerSafeMessage: 'credential gone' })
    .mockReturnValueOnce({ category: 'unknown', error: cause });
  const deps = { ...f.deps, credentials: { ...f.deps.credentials, resolveTarget, request, classifyError },
    messages: { ...f.deps.messages, noSavedCredential: ({ label }: { label: string }) => `Reconnect ${label}` } };
  const ctx = await boundContext({ deps, platform: f.platform });
  await expect(ctx.get(endpoint)).rejects.toMatchObject({ message: "Credential 'key' does not allow host 'api.library.test'. Add that host to the saved credential or choose another credentialLabel." });
  await expect(ctx.get(endpoint)).rejects.toMatchObject({ message: 'Reconnect key' });
  await expect(ctx.get(endpoint)).rejects.toBe(cause);
  expect(resolveTarget.mock.calls).toEqual(Array(3).fill([{ workspaceId: 'space', label: 'key', url: endpoint }, {}]));
  expect(request).not.toHaveBeenCalled();
});

it("refuses missing or ambiguous deployment credentials without reaching the provider", async () => {
  const f = wire();
  const list = vi.fn<DeployOpsRuntime['credentials']['list']>(async () => [
    { label: 'z-primary', allowedOrigins: ['https://api.library.test'] },
    { label: 'foreign', allowedOrigins: ['https://unrelated.test'] },
    { label: 'a-secondary', allowedOrigins: ['https://api.library.test'] },
  ]);
  f.deps.credentials.list = list;
  const severalCredentials = vi.fn<DeployOpsRuntime['messages']['severalCredentials']>(({ host, labels }) => `Choose for ${host}: ${labels.join(', ')}`);
  f.deps.messages.severalCredentials = severalCredentials;
  const setup = { setupToolId: 'link_library' };
  const setupRequired = vi.fn(() => ({ message: 'Missing credential', credentialSetup: setup }));
  f.deps.recovery.setupRequired = setupRequired;

  await expect(f.call(ids.status, input)).rejects.toThrow('Choose for api.library.test: a-secondary, z-primary');
  expect(await f.call(ids.status, { ...input, credentialLabel: 'removed' })).toEqual({ executed: false, credentialSetup: setup });
  expect(severalCredentials.mock.calls).toEqual([[{ host: 'api.library.test', labels: ['a-secondary', 'z-primary'] }]]);
  expect(setupRequired.mock.calls).toEqual([[{ label: 'removed', baseUrl: 'https://api.library.test' }]]);
  expect(f.events).toEqual([]);
});

it("refuses secret work on an observe-only platform or an already cancelled request", async () => {
  const f = wire();
  const list = vi.fn(f.deps.credentials.list);
  f.deps.credentials.list = list;
  const load = vi.fn(f.deps.loadDeployOps);
  f.deps.loadDeployOps = load;
  const preAborted = runListSecrets({ deps: f.deps, input }, { signal: AbortSignal.abort() });
  await expect(preAborted).rejects.toBeInstanceOf(ToolInputError);
  await expect(preAborted).rejects.toThrow('Deployment ops wait was aborted.');
  expect(load).not.toHaveBeenCalled();
  const noAdapter = runListSecrets({ deps: f.deps, input });
  await expect(noAdapter).rejects.toBeInstanceOf(ToolInputError);
  await expect(noAdapter).rejects.toThrow("Deployment ops platform 'library' has no secrets adapter. Platforms with one: (none).");
  expect(list).not.toHaveBeenCalled();
});
