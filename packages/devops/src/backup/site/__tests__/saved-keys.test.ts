import { describe, expect, it } from 'vitest';
import { createSiteSavedKeys } from '../saved-keys.js';

/** The optional transport is retired by P25. No legacy envelope can authorize a new site. */
function fixture() {
  let reads = 0;
  const keys = createSiteSavedKeys({ workspaceId: 'source',
    openSnapshot: async () => { reads++; throw new Error('capture must not read site keys'); },
    captureProject: async () => { reads++; throw new Error('capture must not read owner keys'); },
    openRecipient: async () => { reads++; throw new Error('import must not persist keys or grants'); },
  } as never);
  return { keys, reads: () => reads };
}

describe('site saved keys', () => {
  it('capture is refused even when source and project keys are available', async () => {
    const f = fixture();
    await expect(f.keys.capture({ workspaceId: 'source', shareId: 'share', snapshot: Buffer.alloc(0) })).rejects.toThrow(/no longer include saved keys/);
    expect(f.reads()).toBe(0);
  });

  for (const password of [undefined, 'correct-legacy-password', 'wrong-password']) {
    it(`historical key bundles require fresh site approval (password supplied: ${password !== undefined})`, async () => {
      const f = fixture();
      const response = await f.keys.restore({ siteId: 'new-site', dir: '/tmp/unopened-site', dbPath: '/tmp/unopened-content.db',
        encryptedKeys: Buffer.from('historical-encrypted-payload'), ...(password === undefined ? {} : { password }) });
      expect(response.notices.join()).toMatch(/approve fresh access/);
      expect(f.reads()).toBe(0);
      expect(JSON.stringify(response).includes('legacy-password')).toBe(false);
    });
  }

  it('cancelled import is refused before any recipient resource opens', async () => {
    const f = fixture(), abort = new AbortController(); abort.abort();
    await expect(f.keys.restore({ siteId: 'new', dir: '/tmp/unused', dbPath: '/tmp/unused.db', encryptedKeys: Buffer.alloc(0) }, { signal: abort.signal })).rejects.toThrow();
    expect(f.reads()).toBe(0);
  });

  it('reveal opens the sealed password with the host-injected domain and an unaliasable tuple', async () => {
    const seen: { sealed: unknown; aad: string | undefined }[] = [];
    const sealer = { open: async (required: { sealed: unknown }, optional: { aad?: string } = {}) => { seen.push({ sealed: required.sealed, aad: optional.aad }); return 'pw'; } };
    const sealedPassword = { v: 1 } as never;
    const a = createSiteSavedKeys({ workspaceId: 'ws', sealer: sealer as never, passwordAadDomain: 'host-domain' });
    expect(await a.reveal({ sealedPassword, shareId: 'share-1', workspaceId: 'ws' })).toEqual({ password: 'pw' });
    expect(seen[0]).toEqual({ sealed: sealedPassword, aad: '["host-domain",1,"ws","share-1"]' });
    const b = createSiteSavedKeys({ workspaceId: 'a","b', sealer: sealer as never, passwordAadDomain: 'host-domain' });
    await b.reveal({ sealedPassword, shareId: 'c', workspaceId: 'a","b' });
    expect(seen[1]!.aad).toBe(JSON.stringify(['host-domain', 1, 'a","b', 'c']));
  });

  it('reveal refuses another workspace before opening anything', async () => {
    let opened = 0;
    const sealer = { open: async () => { opened++; return 'pw'; } };
    const keys = createSiteSavedKeys({ workspaceId: 'ws', sealer: sealer as never, passwordAadDomain: 'd' });
    await expect(keys.reveal({ sealedPassword: {} as never, shareId: 's', workspaceId: 'other' })).rejects.toThrow(/workspace mismatch/);
    expect(opened).toBe(0);
  });
});
