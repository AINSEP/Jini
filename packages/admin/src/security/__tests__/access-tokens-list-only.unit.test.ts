import { describe, expect, it } from 'vitest';
import { createMemorySecurityApi } from '../adapters/memory.js';
import { createAccessTokensController } from '../controllers/access-tokens.controller.js';
import type { CredentialProvider, CredentialSummary } from '../models.js';
import type { CredentialStorePort, SecurityApiPort } from '../ports.js';

const providers: CredentialProvider[] = [{ kind: 'publish', id: 'zed', label: 'Zed hosting', vendorLabel: 'Zed', category: 'hosting', tokenField: 'token', fields: [] }];
const row: CredentialSummary = { kind: 'publish', id: '1', providerId: 'zed', label: 'Deploy', configured: true, isDefault: true, createdAt: 'c', updatedAt: 'u' };
const WRITE = ['security.read', 'system.publish'];

/** A host store that implements only the required members: no `snapshot`. */
function listOnly(store: CredentialStorePort): CredentialStorePort {
  return { list: (r, o) => store.list(r, o), create: (r, o) => store.create(r, o), update: (r, o) => store.update(r, o), remove: (r, o) => store.remove(r, o) };
}

describe('access tokens controller with a list-only store (SEC-9)', () => {
  it('loads the rows from list and reports no store-level facts', async () => {
    const memory = createMemorySecurityApi({ providers, rows: [row], executionMode: 'hosted-api-only' });
    const api: SecurityApiPort = { ...memory, publish: listOnly(memory.publish) };
    const c = createAccessTokensController({ api, permissions: WRITE });
    await c.load({});
    expect(c.getSnapshot().rows.map(r => r.id)).toEqual(['1']);
    // executionMode only travels on a store snapshot, which this store does not have.
    expect(c.getSnapshot().executionMode ?? null).toBeNull();
    // Control: the same store with its snapshot does report it.
    const full = createAccessTokensController({ api: memory, permissions: WRITE });
    await full.load({});
    expect(full.getSnapshot().executionMode).toBe('hosted-api-only');
  });

  it('has no pending changes while no editor is open', async () => {
    const c = createAccessTokensController({ api: createMemorySecurityApi({ providers, rows: [row] }), permissions: WRITE });
    await c.load({});
    expect(c.getSnapshot().draft).toBeNull();
    expect(c.hasChanges({})).toBe(false);
    c.begin({ kind: 'publish', providerId: 'zed' });
    expect(c.hasChanges({})).toBe(true);
  });
});
