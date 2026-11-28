import { describe, expect, it } from 'vitest';
import { createHttpCredentialCopy, createHttpCustomCredentials, createHttpOtherCredentials, createHttpSecurityApi } from '../adapters/http.js';
import type { RequestOptions } from '../models.js';
import type { SecurityTransportPort } from '../ports.js';

type Call = Parameters<SecurityTransportPort['request']>[0];
function transport(replies: unknown[]) {
  const calls: Call[] = [];
  const port: SecurityTransportPort = { async request<T>(required: Call, _optional: RequestOptions = {}): Promise<T> { calls.push(required); return replies.shift() as T; } };
  return { port, calls };
}
function aborted() { const controller = new AbortController(); controller.abort(); return controller.signal; }

describe('security HTTP adapters: aborted requests are never sent', () => {
  it('rejects every aborted call before it reaches the transport', async () => {
    const t = transport([]);
    const api = createHttpSecurityApi({ transport: t.port, workspacePath: '/w' }, { sharedKeys: true });
    const copy = createHttpCredentialCopy({ transport: t.port, workspacePath: '/w' });
    const custom = createHttpCustomCredentials({ transport: t.port, workspacePath: '/w' });
    const signal = aborted();
    await expect(api.publish.verify!({ id: 'a' }, { signal })).rejects.toThrow('This operation was aborted');
    await expect(api.useProjectKey!({ keyId: 'k', use: true }, { signal })).rejects.toThrow('This operation was aborted');
    await expect(copy.listCredentialCopySources({}, { signal })).rejects.toThrow('This operation was aborted');
    await expect(copy.copyCredentials({ sourceSiteId: 'shared-keys', ids: ['k1'], overwrite: false }, { signal })).rejects.toThrow('This operation was aborted');
    await expect(custom.listCustomCredentials({}, { signal })).rejects.toThrow('This operation was aborted');
    expect(t.calls).toEqual([]);
  });
});

describe('security HTTP adapters: explicit projections', () => {
  it('keeps a verification account label and drops every undeclared field', async () => {
    const t = transport([{ verification: { status: 'ok', message: 'Fine', checkedAt: 'now', accountLabel: 'team@zed', token: 'tok-a' } }]);
    const api = createHttpSecurityApi({ transport: t.port, workspacePath: '/w' });
    expect(await api.publish.verify!({ id: 'a/b' })).toEqual({ status: 'ok', message: 'Fine', checkedAt: 'now', accountLabel: 'team@zed' });
    expect(t.calls).toEqual([{ method: 'POST', path: '/w/system/publish/credentials/a%2Fb/verify' }]);
    const bare = transport([{ verification: { status: 'failed', message: 'Expired', checkedAt: 'now' } }]);
    const result = await createHttpSecurityApi({ transport: bare.port, workspacePath: '/w' }).publish.verify!({ id: 'a' });
    expect(result).toEqual({ status: 'failed', message: 'Expired', checkedAt: 'now' });
    expect('accountLabel' in result).toBe(false);
  });

  it('keeps only the three action-hint fields of a copy source', async () => {
    const t = transport([{ sources: [{ siteId: 'blog', name: 'Blog', keys: [], actionHint: { action: 'open-site', siteId: 's1', desktopSiteId: 'd1', token: 'tok-a' } }] }]);
    const { sources } = await createHttpCredentialCopy({ transport: t.port, workspacePath: '/w' }).listCredentialCopySources({});
    expect(sources).toEqual([{ siteId: 'blog', name: 'Blog', keys: [], actionHint: { action: 'open-site', siteId: 's1', desktopSiteId: 'd1' } }]);
  });

  it('cuts every masked hint to four characters and keeps a length only when the server sent a number', async () => {
    const t = transport([
      { data: { isSet: true, updatedAt: 'd', tokenHint: { last4: 'xyz789', length: 40 } } },
      { data: { isSet: true, updatedAt: 'd', tokenHint: { last4: 'ab12', length: '40' } } },
      { data: { isSet: true, updatedAt: 'd', masked: '••••••cd34' } },
      { data: { isSet: true, updatedAt: 'd', masked: '••••' } },
    ]);
    const api = createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' }, { tokenHints: true });
    const hint = async () => (await api.list({ store: 'site-assistant' }))[0]!.tokenHint;
    expect(await hint()).toEqual({ last4: 'z789', length: 40 });
    expect(await hint()).toEqual({ last4: 'ab12' });
    expect(await hint()).toEqual({ last4: 'cd34' });
    // A tail that is only mask dots carries no characters: no hint at all.
    expect(await hint()).toBeUndefined();
  });
});
