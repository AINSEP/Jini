import { describe, expect, it, vi } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { SECRET_NAME_PATTERN, runListSecrets, runSetSecret, runUnsetSecret } from '../ops-secrets.js';
import type { DeployOpsModule, DeployOpsRegistry, LoadedDeployOps } from '../ops-contracts.js';
import type { DeployOpsRuntime, SecretConfirm } from '../ops-tool-contracts.js';

const HOST = 'api.host.example';
const ORIGIN = `https://${HOST}`;
const ABORT_MSG = 'Deployment ops wait was aborted.';
const SITE_KEY = 'site-key-value-0123';

type Mod = Partial<DeployOpsModule>;
function secretModule(over: Mod = {}): DeployOpsModule {
  return {
    status: async () => { throw new Error('unused'); },
    logs: async () => { throw new Error('unused'); },
    secretCapabilities: { appliesOn: 'next-deploy', supportsStaging: true },
    listSecrets: vi.fn(async () => ({ secrets: [] })),
    setSecret: vi.fn(async () => ({})),
    unsetSecret: vi.fn(async () => ({})),
    ...over,
  };
}
const platformOf = (module: DeployOpsModule, id = 'p'): LoadedDeployOps => ({ descriptor: { id, label: id, module: 'm.mjs', hosts: [HOST] }, pluginId: 'plug', module });
const registryOf = (...ps: LoadedDeployOps[]): DeployOpsRegistry => ({ get: id => ps.find(p => p.descriptor.id === id), list: () => ps, refusals: [] });

function makeDeps(module: DeployOpsModule = secretModule(), over: Partial<DeployOpsRuntime> = {}, extra: LoadedDeployOps[] = []) {
  const request = vi.fn(async () => ({ status: 200, bodyText: '{}', bodyTruncated: false }));
  const deps = {
    workspaceId: 'ws1',
    clock: { nowMs: () => 0 },
    loadDeployOps: vi.fn(async () => registryOf(platformOf(module), ...extra)),
    credentials: {
      available: true,
      list: vi.fn(async () => [{ label: 'main', allowedOrigins: [ORIGIN] }]),
      resolveTarget: vi.fn(async () => undefined),
      classifyError: () => ({ category: 'other' }),
      request,
    },
    recovery: { setupRequired: ({ label }: { label: string }) => ({ message: `setup ${label}`, credentialSetup: {} }) },
    toolIds: { status: 'ops_status', logs: 'l', wait: 'w', listTargets: 't', deploy: 'ops_deploy', listSecrets: 'ops_list_secrets', setSecret: 'ss', unsetSecret: 'ops_unset', credentialVerify: 'cv' },
    messages: { noUsableSiteKey: 'NO SITE KEY', severalCredentials: () => 'several', noSavedCredential: () => 'none' },
    siteKey: { read: vi.fn(() => SITE_KEY as string | undefined), fingerprint: vi.fn(({ value }: { value: string }) => ({ fingerprint: `len${value.length}`, fingerprintKind: 'sha256' as const })) },
    ...over,
  } as unknown as DeployOpsRuntime;
  return { deps, request, module };
}
const catchErr = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected rejection'); };
const approve: SecretConfirm = vi.fn(async () => ({ confirmed: true as const }));
const target = { platform: 'p', target: 'app' };
const siteKeyInput = { ...target, name: 'APP_KEY', source: { kind: 'site-key' as const } };

describe('SECRET_NAME_PATTERN', () => {
  it.each(['A', '_x', 'APP_KEY_2', 'a'.repeat(128)])('accepts %s', n => expect(SECRET_NAME_PATTERN.test(n)).toBe(true));
  it.each(['', '1A', 'A-B', 'A B', 'a'.repeat(129)])('rejects %j', n => expect(SECRET_NAME_PATTERN.test(n)).toBe(false));
});

describe('runListSecrets', () => {
  it('lists names, digests and update times with when writes apply', async () => {
    const listSecrets = vi.fn(async () => ({ secrets: [{ name: 'A', digest: 'd1', updatedAt: '2026-01-01' }, { name: 'B' }] }));
    const { deps } = makeDeps(secretModule({ listSecrets }));
    expect(await runListSecrets({ deps, input: target })).toEqual({
      platform: 'p', target: 'app', secrets: [{ name: 'A', digest: 'd1', updatedAt: '2026-01-01' }, { name: 'B' }], truncated: false,
      appliesOn: 'next-deploy', supportsStaging: true, deployNeeded: true,
    });
    expect(listSecrets.mock.calls[0]![1]).toEqual({ target: 'app' });
  });

  it('reports immediate application as no deploy needed', async () => {
    const { deps } = makeDeps(secretModule({ secretCapabilities: { appliesOn: 'immediately', supportsStaging: false } }));
    const res = await runListSecrets({ deps, input: target });
    expect(res).toMatchObject({ appliesOn: 'immediately', supportsStaging: false, deployNeeded: false });
  });

  it('clips long fields and ignores non-string digest/updatedAt', async () => {
    const listSecrets = vi.fn(async () => ({ secrets: [{ name: 'n'.repeat(300), digest: 'd'.repeat(300), updatedAt: 'u'.repeat(300) }, { name: 'X', digest: 5 as never, updatedAt: 6 as never }] }));
    const { deps } = makeDeps(secretModule({ listSecrets }));
    const res = await runListSecrets({ deps, input: target });
    expect(res.secrets[0]!.name).toHaveLength(128);
    expect(res.secrets[0]!.digest).toHaveLength(200);
    expect(res.secrets[0]!.updatedAt).toHaveLength(64);
    expect(res.secrets[1]).toEqual({ name: 'X' });
  });

  it('caps at 500 entries and marks the list truncated', async () => {
    const secrets = Array.from({ length: 501 }, (_, i) => ({ name: `S${i}` }));
    const { deps } = makeDeps(secretModule({ listSecrets: vi.fn(async () => ({ secrets })) }));
    const res = await runListSecrets({ deps, input: target });
    expect(res.secrets).toHaveLength(500);
    expect(res.truncated).toBe(true);
  });

  it('keeps exactly 500 untruncated, and honours an adapter truncated flag only when true', async () => {
    const full = Array.from({ length: 500 }, (_, i) => ({ name: `S${i}` }));
    const a = makeDeps(secretModule({ listSecrets: vi.fn(async () => ({ secrets: full })) }));
    expect((await runListSecrets({ deps: a.deps, input: target })).truncated).toBe(false);
    const b = makeDeps(secretModule({ listSecrets: vi.fn(async () => ({ secrets: [], truncated: true })) }));
    expect((await runListSecrets({ deps: b.deps, input: target })).truncated).toBe(true);
    const c = makeDeps(secretModule({ listSecrets: vi.fn(async () => ({ secrets: [], truncated: 'yes' as never })) }));
    expect((await runListSecrets({ deps: c.deps, input: target })).truncated).toBe(false);
  });

  it.each([
    ['undefined result', undefined],
    ['secrets not an array', { secrets: 'x' }],
    ['null entry', { secrets: [null] }],
    ['non-string name', { secrets: [{ name: 3 }] }],
    ['empty name', { secrets: [{ name: '' }] }],
  ])('refuses a malformed adapter list: %s', async (_n, result) => {
    const { deps } = makeDeps(secretModule({ listSecrets: vi.fn(async () => result as never) }));
    expect((await catchErr(runListSecrets({ deps, input: target }))).message).toBe("Deployment ops platform 'p' returned an invalid secret list.");
  });

  it('refuses an unknown platform', async () => {
    const { deps } = makeDeps();
    expect((await catchErr(runListSecrets({ deps, input: { ...target, platform: 'zz' } }))).message).toBe("Unknown deployment ops platform 'zz'. Choose: p.");
  });

  it('refuses a platform without secrets adapter and names those with one', async () => {
    const bare = platformOf({ status: async () => { throw 0; }, logs: async () => { throw 0; } }, 'bare');
    const { deps } = makeDeps(secretModule(), {}, [bare]);
    expect((await catchErr(runListSecrets({ deps, input: { ...target, platform: 'bare' } }))).message).toBe("Deployment ops platform 'bare' has no secrets adapter. Platforms with one: p.");
  });

  it('refuses a platform whose setSecret lacks capabilities, and says none when no platform qualifies', async () => {
    const { deps } = makeDeps(secretModule({ setSecret: undefined, secretCapabilities: undefined }));
    expect((await catchErr(runListSecrets({ deps, input: target }))).message).toBe("Deployment ops platform 'p' has no secrets adapter. Platforms with one: (none).");
    const half = makeDeps(secretModule({ secretCapabilities: undefined }));
    expect((await catchErr(runListSecrets({ deps: half.deps, input: target }))).message).toContain('Platforms with one: p.');
  });

  it('refuses an aborted signal before loading', async () => {
    const { deps } = makeDeps();
    const ac = new AbortController(); ac.abort();
    expect((await catchErr(runListSecrets({ deps, input: target }, { signal: ac.signal }))).message).toBe(ABORT_MSG);
    expect(deps.loadDeployOps).not.toHaveBeenCalled();
  });
});

describe('runSetSecret input validation', () => {
  it.each(['1bad', 'has-dash', ''])('refuses secret name %j', async name => {
    const { deps } = makeDeps();
    const err = await catchErr(runSetSecret({ deps, input: { ...siteKeyInput, name } }));
    expect(err.message).toBe('name must be an environment variable name (letters, digits and underscores, not starting with a digit, at most 128 characters).');
  });

  it('refuses a bad source.name with its own key', async () => {
    const { deps } = makeDeps(secretModule({ readSecret: vi.fn() }));
    const err = await catchErr(runSetSecret({ deps, input: { ...target, name: 'A', source: { kind: 'secret', name: 'bad-name' } } }));
    expect(err.message).toMatch(/^source\.name must be an environment variable name/);
  });

  it('refuses copying a secret onto itself', async () => {
    const { deps } = makeDeps(secretModule({ readSecret: vi.fn() }));
    expect((await catchErr(runSetSecret({ deps, input: { ...target, name: 'A', source: { kind: 'secret', name: 'A' } } }))).message).toBe('source.name must differ from name; a secret cannot be copied onto itself.');
  });

  it('refuses a copy on a platform that cannot read secret values', async () => {
    const { deps } = makeDeps();
    expect((await catchErr(runSetSecret({ deps, input: { ...target, name: 'A', source: { kind: 'secret', name: 'B' } } }))).message).toBe("Deployment ops platform 'p' cannot read secret values, so it cannot copy one secret to another. Use source kind 'site-key'.");
  });

  it.each([undefined, ''])('refuses a site-key source when no usable key exists (%j)', async key => {
    const { deps, module } = makeDeps();
    (deps.siteKey.read as ReturnType<typeof vi.fn>).mockReturnValue(key);
    expect((await catchErr(runSetSecret({ deps, input: siteKeyInput }))).message).toBe('NO SITE KEY');
    expect(module.setSecret).not.toHaveBeenCalled();
  });

  it('refuses an aborted signal first', async () => {
    const { deps } = makeDeps();
    const ac = new AbortController(); ac.abort();
    expect((await catchErr(runSetSecret({ deps, input: siteKeyInput }, { signal: ac.signal }))).message).toBe(ABORT_MSG);
  });
});

describe('runSetSecret writing', () => {
  it('creates an absent secret without asking, from the site key, never echoing the value', async () => {
    const setSecret = vi.fn(async () => ({ version: 'v7' }));
    const readSecret = vi.fn(async () => ({ absent: true as const }));
    const { deps } = makeDeps(secretModule({ setSecret, readSecret }));
    const confirm = vi.fn(approve);
    const res = await runSetSecret({ deps, input: siteKeyInput }, { confirm });
    expect(confirm).not.toHaveBeenCalled();
    expect(setSecret.mock.calls[0]![1]).toEqual({ target: 'app', name: 'APP_KEY', value: SITE_KEY });
    expect(res).toEqual({
      platform: 'p', target: 'app', name: 'APP_KEY', source: { kind: 'site-key' }, comparison: 'absent',
      fingerprint: `len${SITE_KEY.length}`, fingerprintKind: 'sha256', appliesOn: 'next-deploy', supportsStaging: true, deployNeeded: true,
      changed: true, version: 'v7',
      summary: "Set 'APP_KEY' on 'app' from this site's key. The running app keeps the old environment until the next deploy of 'app' (ops_deploy).",
    });
    expect(JSON.stringify(res)).not.toContain(SITE_KEY);
  });

  it('accepts a numeric vendor version and omits a missing one', async () => {
    const a = makeDeps(secretModule({ setSecret: vi.fn(async () => ({ version: 12 })), readSecret: vi.fn(async () => ({ absent: true as const })) }));
    expect((await runSetSecret({ deps: a.deps, input: siteKeyInput })).version).toBe('12');
    const b = makeDeps(secretModule({ setSecret: vi.fn(async () => undefined as never), readSecret: vi.fn(async () => ({ absent: true as const })) }));
    expect(await runSetSecret({ deps: b.deps, input: siteKeyInput })).not.toHaveProperty('version');
  });

  it('omits the deploy hint when the vendor applies secrets at once', async () => {
    const { deps } = makeDeps(secretModule({ secretCapabilities: { appliesOn: 'immediately', supportsStaging: false }, readSecret: vi.fn(async () => ({ absent: true as const })) }));
    const res = await runSetSecret({ deps, input: siteKeyInput });
    expect(res.summary).toBe("Set 'APP_KEY' on 'app' from this site's key.");
    expect(res.deployNeeded).toBe(false);
  });

  it('skips the write when the stored value is identical', async () => {
    const setSecret = vi.fn(async () => ({}));
    const { deps } = makeDeps(secretModule({ setSecret, readSecret: vi.fn(async () => ({ value: SITE_KEY })) }));
    const res = await runSetSecret({ deps, input: siteKeyInput });
    expect(setSecret).not.toHaveBeenCalled();
    expect(res).toMatchObject({ changed: false, comparison: 'same', deployNeeded: false, summary: "'APP_KEY' on 'app' already holds this site's key; nothing was written." });
  });

  it('asks a human before replacing a different value, with the frozen request', async () => {
    const setSecret = vi.fn(async () => ({}));
    const { deps } = makeDeps(secretModule({ setSecret, readSecret: vi.fn(async () => ({ value: 'old' })) }));
    const confirm = vi.fn<SecretConfirm>(async () => ({ confirmed: true }));
    const res = await runSetSecret({ deps, input: siteKeyInput }, { confirm });
    expect(confirm).toHaveBeenCalledWith({ action: 'overwrite', platform: 'p', target: 'app', name: 'APP_KEY', source: "this site's key", comparison: 'different', appliesOn: 'next-deploy' });
    expect(setSecret).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ changed: true, comparison: 'different' });
  });

  it('writes nothing and relays the refusal when the human declines', async () => {
    const setSecret = vi.fn(async () => ({}));
    const { deps } = makeDeps(secretModule({ setSecret, readSecret: vi.fn(async () => ({ value: 'old' })) }));
    const confirm: SecretConfirm = async () => ({ confirmed: false, result: { cancelled: true, reason: 'expired', note: 'Timed out.' } });
    const res = await runSetSecret({ deps, input: siteKeyInput }, { confirm });
    expect(setSecret).not.toHaveBeenCalled();
    expect(res).toMatchObject({ changed: false, deployNeeded: false, cancelled: true, reason: 'expired', note: 'Timed out.', comparison: 'different' });
  });

  it('fails closed with no confirmation channel for an existing secret', async () => {
    const setSecret = vi.fn(async () => ({}));
    const { deps } = makeDeps(secretModule({ setSecret, readSecret: vi.fn(async () => ({ value: 'old' })) }));
    expect((await catchErr(runSetSecret({ deps, input: siteKeyInput }))).message).toBe("Changing existing secret 'APP_KEY' needs a human confirmation, and this call has no way to ask. Nothing was changed.");
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('refuses to write if aborted while the human was answering', async () => {
    const setSecret = vi.fn(async () => ({}));
    const { deps } = makeDeps(secretModule({ setSecret, readSecret: vi.fn(async () => ({ value: 'old' })) }));
    const ac = new AbortController();
    const confirm: SecretConfirm = async () => { ac.abort(); return { confirmed: true }; };
    expect((await catchErr(runSetSecret({ deps, input: siteKeyInput }, { confirm, signal: ac.signal }))).message).toBe(ABORT_MSG);
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('dry-run reports creation for an absent secret without writing', async () => {
    const setSecret = vi.fn(async () => ({}));
    const { deps } = makeDeps(secretModule({ setSecret, readSecret: vi.fn(async () => ({ absent: true as const })) }));
    const res = await runSetSecret({ deps, input: { ...siteKeyInput, dryRun: true } });
    expect(setSecret).not.toHaveBeenCalled();
    expect(res).toMatchObject({ changed: false, dryRun: true, deployNeeded: false, summary: "Dry run: 'APP_KEY' would be created from this site's key. Nothing was written." });
  });

  it('dry-run reports replacement for an existing different secret without asking', async () => {
    const { deps, module } = makeDeps(secretModule({ readSecret: vi.fn(async () => ({ value: 'old' })) }));
    const confirm = vi.fn(approve);
    const res = await runSetSecret({ deps, input: { ...siteKeyInput, dryRun: true } }, { confirm });
    expect(confirm).not.toHaveBeenCalled();
    expect(module.setSecret).not.toHaveBeenCalled();
    expect(res.summary).toBe("Dry run: 'APP_KEY' would be replaced from this site's key. Nothing was written.");
  });
});

describe('runSetSecret comparison without a readable value', () => {
  const noRead = (list: Array<{ name: string }>, truncated = false) => secretModule({ listSecrets: vi.fn(async () => ({ secrets: list, truncated })) });

  it('treats a name missing from a complete list as absent', async () => {
    const { deps, module } = makeDeps(noRead([{ name: 'OTHER' }]));
    const res = await runSetSecret({ deps, input: siteKeyInput });
    expect(res.comparison).toBe('absent');
    expect(module.setSecret).toHaveBeenCalledTimes(1);
  });

  it('treats a listed name as unknown and confirms', async () => {
    const { deps, module } = makeDeps(noRead([{ name: 'APP_KEY' }]));
    const confirm = vi.fn<SecretConfirm>(async () => ({ confirmed: true }));
    const res = await runSetSecret({ deps, input: siteKeyInput }, { confirm });
    expect(res.comparison).toBe('unknown');
    expect(confirm.mock.calls[0]![0].comparison).toBe('unknown');
    expect(module.setSecret).toHaveBeenCalledTimes(1);
  });

  it('cannot rule out presence on a truncated list', async () => {
    const { deps } = makeDeps(noRead([], true));
    const res = await runSetSecret({ deps, input: { ...siteKeyInput, dryRun: true } });
    expect(res.comparison).toBe('unknown');
    expect(res.summary).toContain('would be replaced');
  });

  it('degrades to the list when the adapter cannot read the value', async () => {
    const { deps } = makeDeps(secretModule({ readSecret: vi.fn(async () => { throw new Error('no scope'); }), listSecrets: vi.fn(async () => ({ secrets: [] })) }));
    expect((await runSetSecret({ deps, input: siteKeyInput })).comparison).toBe('absent');
  });

  it('rethrows a read failure when the call was cancelled', async () => {
    const ac = new AbortController();
    const boom = new Error('read cancelled');
    const { deps } = makeDeps(secretModule({ readSecret: vi.fn(async () => { ac.abort(); throw boom; }) }));
    expect(await catchErr(runSetSecret({ deps, input: siteKeyInput }, { signal: ac.signal }))).toBe(boom);
  });

  it.each([['empty object', {}], ['non-string value', { value: 5 }], ['absent false', { absent: false }], ['undefined', undefined]])('falls back to the list for an unrecognised read result: %s', async (_n, read) => {
    const { deps } = makeDeps(secretModule({ readSecret: vi.fn(async () => read as never), listSecrets: vi.fn(async () => ({ secrets: [{ name: 'APP_KEY' }] })) }));
    expect((await runSetSecret({ deps, input: { ...siteKeyInput, dryRun: true } })).comparison).toBe('unknown');
  });
});

describe('runSetSecret sources', () => {
  const typedInput = { ...target, name: 'TOKEN', source: { kind: 'typed' as const } };
  const absentRead = () => vi.fn(async () => ({ absent: true as const }));

  it('writes a value typed in the secure card byte-for-byte, and describes the card', async () => {
    const setSecret = vi.fn(async () => ({}));
    const { deps } = makeDeps(secretModule({ setSecret, readSecret: absentRead() }));
    const value = '  line1\nline2  ';
    const res = await runSetSecret({ deps, input: typedInput }, { typedValue: value });
    expect(setSecret.mock.calls[0]![1]).toEqual({ target: 'app', name: 'TOKEN', value });
    expect(res.summary).toMatch(/^Set 'TOKEN' on 'app' from the secure card\./);
    expect(deps.siteKey.read).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).not.toContain('line1');
  });

  it.each([['undefined', undefined], ['number', 5], ['blank', '  \n '], ['too long', 'x'.repeat(8193)]])('refuses a typed value that is %s', async (_n, typedValue) => {
    const { deps, module } = makeDeps(secretModule({ readSecret: absentRead() }));
    expect((await catchErr(runSetSecret({ deps, input: typedInput }, { typedValue }))).message).toBe('The secure form requires a non-blank secret of at most 8192 characters.');
    expect(module.setSecret).not.toHaveBeenCalled();
  });

  it('accepts a typed value of exactly 8192 characters', async () => {
    const { deps, module } = makeDeps(secretModule({ readSecret: absentRead() }));
    await runSetSecret({ deps, input: typedInput }, { typedValue: 'x'.repeat(8192) });
    expect(module.setSecret).toHaveBeenCalledTimes(1);
  });

  it('copies another secret on the same target vendor-side', async () => {
    const setSecret = vi.fn(async () => ({}));
    const readSecret = vi.fn(async (_ctx: unknown, { name }: { target: string; name: string }) => (name === 'SRC' ? { value: 'copied-value' } : { absent: true as const }));
    const { deps } = makeDeps(secretModule({ setSecret, readSecret }));
    const res = await runSetSecret({ deps, input: { ...target, name: 'DST', source: { kind: 'secret', name: 'SRC' } } });
    expect(readSecret.mock.calls.map(c => c[1])).toEqual([{ target: 'app', name: 'SRC' }, { target: 'app', name: 'DST' }]);
    expect(setSecret.mock.calls[0]![1]).toEqual({ target: 'app', name: 'DST', value: 'copied-value' });
    expect(res.summary).toMatch(/^Set 'DST' on 'app' from secret SRC\./);
    expect(res.fingerprint).toBe('len12');
  });

  it.each([['absent', { absent: true }], ['non-string', { value: 3 }], ['undefined', undefined]])('refuses to copy a source that reads %s', async (_n, read) => {
    const { deps, module } = makeDeps(secretModule({ readSecret: vi.fn(async () => read as never) }));
    const err = await catchErr(runSetSecret({ deps, input: { ...target, name: 'DST', source: { kind: 'secret', name: 'SRC' } } }));
    expect(err.message).toBe("Secret 'SRC' is not set on 'app', so there is nothing to copy. List the secrets with ops_list_secrets.");
    expect(module.setSecret).not.toHaveBeenCalled();
  });
});

describe('runUnsetSecret', () => {
  const unsetInput = { ...target, name: 'OLD' };
  const present = [{ name: 'OLD', digest: 'd1' }, { name: 'KEEP' }];
  const withList = (secrets: unknown[], over: Mod = {}) => secretModule({ listSecrets: vi.fn(async () => ({ secrets: secrets as never })), ...over });

  it('refuses an invalid name', async () => {
    const { deps } = makeDeps();
    expect((await catchErr(runUnsetSecret({ deps, input: { ...unsetInput, name: 'bad-name' } }))).message).toMatch(/^name must be an environment variable name/);
  });

  it('refuses an aborted signal', async () => {
    const { deps } = makeDeps();
    const ac = new AbortController(); ac.abort();
    expect((await catchErr(runUnsetSecret({ deps, input: unsetInput }, { signal: ac.signal }))).message).toBe(ABORT_MSG);
  });

  it('reports an absent name instead of deleting', async () => {
    const { deps, module } = makeDeps(withList([{ name: 'KEEP' }]));
    const res = await runUnsetSecret({ deps, input: unsetInput });
    expect(module.unsetSecret).not.toHaveBeenCalled();
    expect(res).toEqual({ platform: 'p', target: 'app', name: 'OLD', appliesOn: 'next-deploy', supportsStaging: true, deployNeeded: false, removed: false, summary: "'OLD' is not set on 'app'; nothing was removed." });
  });

  it('removes after confirmation, passing the frozen request, and reports the deploy hint', async () => {
    const unsetSecret = vi.fn(async () => ({ version: 3 }));
    const { deps } = makeDeps(withList(present, { unsetSecret }));
    const confirm = vi.fn<SecretConfirm>(async () => ({ confirmed: true }));
    const res = await runUnsetSecret({ deps, input: unsetInput }, { confirm });
    expect(confirm).toHaveBeenCalledWith({ action: 'remove', platform: 'p', target: 'app', name: 'OLD', appliesOn: 'next-deploy' });
    expect(unsetSecret.mock.calls[0]![1]).toEqual({ target: 'app', name: 'OLD' });
    expect(res).toMatchObject({ removed: true, version: '3', deployNeeded: true, summary: "Removed 'OLD' from 'app'. The running app keeps the old environment until the next deploy of 'app' (ops_deploy)." });
  });

  it('uses updatedAt alone as a version identity and omits the hint when applied at once', async () => {
    const mod = withList([{ name: 'OLD', updatedAt: 't1' }], { secretCapabilities: { appliesOn: 'immediately', supportsStaging: false } });
    const { deps } = makeDeps(mod);
    const res = await runUnsetSecret({ deps, input: unsetInput }, { confirm: approve });
    expect(res.summary).toBe("Removed 'OLD' from 'app'.");
    expect(res).not.toHaveProperty('version');
  });

  it('lets the module send DELETE for this verb only', async () => {
    const unsetSecret = vi.fn(async (ctx: Parameters<NonNullable<DeployOpsModule['unsetSecret']>>[0]) => { await ctx.send({ method: 'DELETE', url: `${ORIGIN}/secrets/OLD` }); return {}; });
    const { deps, request } = makeDeps(withList(present, { unsetSecret }));
    await runUnsetSecret({ deps, input: unsetInput }, { confirm: approve });
    expect(request.mock.calls[0]![0]).toMatchObject({ method: 'DELETE', url: `${ORIGIN}/secrets/OLD` });
  });

  it('fails closed without a confirmation channel', async () => {
    const { deps, module } = makeDeps(withList(present));
    expect((await catchErr(runUnsetSecret({ deps, input: unsetInput }))).message).toBe("Changing existing secret 'OLD' needs a human confirmation, and this call has no way to ask. Nothing was changed.");
    expect(module.unsetSecret).not.toHaveBeenCalled();
  });

  it('relays a declined confirmation without deleting', async () => {
    const { deps, module } = makeDeps(withList(present));
    const confirm: SecretConfirm = async () => ({ confirmed: false, result: { cancelled: true, reason: 'abandoned', note: 'Left open.' } });
    const res = await runUnsetSecret({ deps, input: unsetInput }, { confirm });
    expect(module.unsetSecret).not.toHaveBeenCalled();
    expect(res).toMatchObject({ removed: false, deployNeeded: false, cancelled: true, reason: 'abandoned', note: 'Left open.' });
  });

  it('refuses when the provider cannot identify the secret version', async () => {
    const { deps, module } = makeDeps(withList([{ name: 'OLD' }]));
    const err = await catchErr(runUnsetSecret({ deps, input: unsetInput }, { confirm: approve }));
    expect(err.message).toBe('ops_unset: the provider cannot identify the current secret version safely. Remove it in the provider console; nothing was deleted.');
    expect(module.unsetSecret).not.toHaveBeenCalled();
  });

  it('refuses when a truncated list does not show the name', async () => {
    const mod = secretModule({ listSecrets: vi.fn(async () => ({ secrets: [{ name: 'KEEP' }], truncated: true })) });
    const { deps } = makeDeps(mod);
    expect((await catchErr(runUnsetSecret({ deps, input: unsetInput }, { confirm: approve }))).message).toMatch(/cannot identify the current secret version safely/);
  });

  it('refuses to delete if cancelled while the human was answering', async () => {
    const { deps, module } = makeDeps(withList(present));
    const ac = new AbortController();
    const confirm: SecretConfirm = async () => { ac.abort(); return { confirmed: true }; };
    expect((await catchErr(runUnsetSecret({ deps, input: unsetInput }, { confirm, signal: ac.signal }))).message).toBe(ABORT_MSG);
    expect(module.unsetSecret).not.toHaveBeenCalled();
  });

  it.each([
    ['its digest changed', [{ name: 'OLD', digest: 'd2' }]],
    ['it was removed', [{ name: 'KEEP' }]],
  ])('refuses to delete when the target changed during confirmation: %s', async (_n, after) => {
    const listSecrets = vi.fn().mockResolvedValueOnce({ secrets: present }).mockResolvedValueOnce({ secrets: after });
    const { deps, module } = makeDeps(secretModule({ listSecrets }));
    const err = await catchErr(runUnsetSecret({ deps, input: unsetInput }, { confirm: approve }));
    expect(err.message).toBe('ops_unset: target changed while confirmation was open. Request a new confirmation; nothing was deleted.');
    expect(module.unsetSecret).not.toHaveBeenCalled();
  });
});
