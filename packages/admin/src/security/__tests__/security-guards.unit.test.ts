import { describe, expect, it } from 'vitest';
import * as security from '../index.js';
import { createMemoryOtherCredentials, createMemorySecurityApi } from '../adapters/memory.js';
import { runSecurityApiConformance } from '../conformance/security-api.conformance.js';
import type { CredentialStorePort, SecurityApiPort } from '../ports.js';
import type { OtherCredentialSummary } from '../models.js';

const providers = [{ kind: 'source-control' as const, id: 'git', label: 'Git host', vendorLabel: 'Git vendor', category: 'source-control' as const, tokenField: 'token', fields: [] }];

/** Wraps a conforming memory API, swapping one store method to model a misbehaving backend. */
function withSourceControl(api: SecurityApiPort, patch: Partial<CredentialStorePort>): SecurityApiPort {
  return { ...api, sourceControl: { ...api.sourceControl, ...patch } };
}

describe('runSecurityApiConformance refusals', () => {
  it('fails a backend that echoes the saved secret and still removes what it created', async () => {
    const api = createMemorySecurityApi({ providers });
    const leaky = withSourceControl(api, {
      create: async (required, optional) => {
        const row = await api.sourceControl.create(required, optional);
        return { ...row, label: `${row.label} ${JSON.stringify(required.connection)}` };
      },
    });
    await expect(runSecurityApiConformance({ createApi: () => leaky, provider: providers[0]! }))
      .rejects.toThrow('Security contract: create cannot return secret');
    await expect(api.sourceControl.list({}, {})).resolves.toEqual([]);
  });

  it('fails a backend that writes even though the request was aborted', async () => {
    const api = createMemorySecurityApi({ providers });
    const ignoresAbort = withSourceControl(api, {
      create: (required) => api.sourceControl.create(required, {}),
    });
    await expect(runSecurityApiConformance({ createApi: () => ignoresAbort, provider: providers[0]! }))
      .rejects.toThrow('Security contract: aborted mutation writes nothing');
  });
});

function mediaRow(overrides: Partial<OtherCredentialSummary> = {}): OtherCredentialSummary {
  return { store: 'media-provider', id: 'm1', label: 'Media', category: 'media', configured: true, supportsReplace: true, ...overrides };
}
const integrationGrants = ['security.read', 'admin.integrations.manage'];

describe('other-credentials controller write guards', () => {
  it('refuses to replace a credential its store cannot replace', async () => {
    const row = mediaRow({ supportsReplace: false });
    const c = security.createOtherCredentialsController({ api: createMemoryOtherCredentials({ rows: [row] }), permissions: integrationGrants });
    c.setDraft({ key: 'media-provider:m1', token: 'NEW' });
    await expect(c.replace({ row })).resolves.toBe(false);
    expect(c.getSnapshot().drafts).toEqual({ 'media-provider:m1': 'NEW' });
  });

  it('refuses to replace with no draft or a whitespace-only draft', async () => {
    const row = mediaRow();
    const c = security.createOtherCredentialsController({ api: createMemoryOtherCredentials({ rows: [row] }), permissions: integrationGrants });
    await expect(c.replace({ row })).resolves.toBe(false);
    c.setDraft({ key: 'media-provider:m1', token: '   ' });
    await expect(c.replace({ row })).resolves.toBe(false);
    expect(c.getSnapshot().saving).toBe(false);
  });

  it('drops a queued write when the controller is disposed before its turn', async () => {
    const rows = [mediaRow({ id: 'a' }), mediaRow({ id: 'b' })];
    const api = createMemoryOtherCredentials({ rows }); const original = api.remove;
    const removed: string[] = []; let release!: () => void;
    api.remove = async (r, o) => { removed.push(r.id); if (r.id === 'a') await new Promise<void>(done => { release = done; }); await original(r, o); };
    const c = security.createOtherCredentialsController({ api, permissions: integrationGrants });
    const first = c.remove({ row: rows[0]! }); const second = c.remove({ row: rows[1]! });
    await Promise.resolve();
    c.dispose({}); release();
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(removed).toEqual(['a']);
  });

  it('surfaces a failed write as a store error and clears the saving flag', async () => {
    const row = mediaRow();
    const api = createMemoryOtherCredentials({ rows: [row] });
    api.remove = () => Promise.reject(new Error('backend detail'));
    const c = security.createOtherCredentialsController({ api, permissions: integrationGrants });
    await expect(c.remove({ row })).resolves.toBe(false);
    expect(c.getSnapshot().errors).toEqual({ 'media-provider': 'Unable to update credential' });
    expect(c.getSnapshot().saving).toBe(false);
  });
});

describe('security public barrel', () => {
  it('routes credential stores and permissions through the exported rules', () => {
    const api = createMemorySecurityApi({ providers });
    expect(security.credentialStore({ api, kind: 'publish' })).toBe(api.publish);
    expect(security.otherWritePermission({ store: 'admin-byok' })).toBe('admin.assistant.manage');
    expect(security.OTHER_STORES).toContain('external-mcp');
    expect(typeof security.createAccessTokensController).toBe('function');
    expect(security.securityModule.id).toBe('security');
  });
});
