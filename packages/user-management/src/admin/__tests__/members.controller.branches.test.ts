import { describe, expect, it } from 'vitest';
import { createMembersController } from '../controllers/members.controller.js';
import { createAuthController } from '../controllers/auth.controller.js';
import type { MembersApiPort } from '../ports.js';
import { memberApi, member, member2, deferred, authApi } from './people.fixtures.js';

const manage = { permissions: ['member.manage'] };

describe('members controller failure and race paths', () => {
  it('reports a roster load failure', async () => {
    const api: MembersApiPort = { ...memberApi(), listMembers: async () => { throw new Error('roster offline'); } };
    const c = createMembersController({ api }, manage);
    await c.load({});
    expect(c.getSnapshot({}).error).toBe('roster offline');
    expect(c.getSnapshot({}).members).toBeNull();
  });

  it('ignores detail toggles before the roster loads and for unknown members', async () => {
    const c = createMembersController({ api: memberApi() }, manage);
    await c.toggleDetail({ id: 'm' });
    expect(c.getSnapshot({}).expandedId).toBeNull();
    await c.load({});
    await c.toggleDetail({ id: 'ghost' });
    expect(c.getSnapshot({}).expandedId).toBeNull();
  });

  it('reports a detail failure only for the row that is still expanded', async () => {
    const real = memberApi();
    const api: MembersApiPort = { ...real, getMember: async () => { throw new Error('detail offline'); } };
    const c = createMembersController({ api }, manage);
    await c.load({});
    await c.toggleDetail({ id: 'm' });
    expect(c.getSnapshot({})).toMatchObject({ expandedId: 'm', detailError: 'detail offline', detailLoadingId: null });
  });

  it('drops a late detail failure after the row was collapsed', async () => {
    const real = memberApi();
    const gate = deferred<never>();
    const api: MembersApiPort = { ...real, getMember: () => gate.promise };
    const c = createMembersController({ api }, manage);
    await c.load({});
    const opening = c.toggleDetail({ id: 'm' });
    await c.toggleDetail({ id: 'm' });
    gate.reject(new Error('late failure'));
    await opening;
    expect(c.getSnapshot({})).toMatchObject({ expandedId: null, detailError: null });
  });

  it('reloads the expanded row detail on refresh, and collapses it when the member disappeared', async () => {
    const real = memberApi();
    let roster = [member, member2];
    const api: MembersApiPort = { ...real, listMembers: async () => ({ members: roster }) };
    const c = createMembersController({ api }, manage);
    await c.load({});
    await c.toggleDetail({ id: 'n' });
    await c.load({});
    expect(c.getSnapshot({})).toMatchObject({ expandedId: 'n', detailById: { n: expect.objectContaining({ id: 'n' }) } });
    roster = [member];
    await c.load({});
    expect(c.getSnapshot({}).expandedId).toBeNull();
  });

  it('records a failed sign-in link resend on the row', async () => {
    const api: MembersApiPort = { ...memberApi(), requestMemberMagicLink: async () => { throw new Error('mailer offline'); } };
    const c = createMembersController({ api }, manage);
    await c.load({});
    await expect(c.resendSignInLink({ id: 'm' })).resolves.toBe(false);
    expect(c.stateFor({ id: 'm' })).toEqual({ disabling: false, resending: false, error: 'mailer offline', notice: null });
  });

  it('refuses to confirm with nothing pending and records a failed disable on the row', async () => {
    const api: MembersApiPort = { ...memberApi(), disableMember: async () => { throw new Error('disable refused'); } };
    const c = createMembersController({ api }, manage);
    await c.load({});
    await expect(c.confirmDestructive({})).resolves.toBe(false);
    c.requestDestructive({ id: 'm' });
    await expect(c.confirmDestructive({})).resolves.toBe(false);
    expect(c.stateFor({ id: 'm' })).toMatchObject({ disabling: false, error: 'disable refused' });
    expect(c.getSnapshot({})).toMatchObject({ pending: null, confirming: false });
    expect(c.getSnapshot({}).members?.find((m) => m.id === 'm')?.status).toBe('active');
  });
});

describe('auth controller', () => {
  it('falls back to a generic message when the port rejects with a non-Error value', async () => {
    const onLogin = () => {};
    const c = createAuthController({ api: { login: () => Promise.reject('nope') }, onLogin });
    c.setDraft({ patch: { username: 'admin', password: 'pw' } });
    await expect(c.submit({})).resolves.toBe(false);
    expect(c.getSnapshot({})).toMatchObject({ error: 'login failed', busy: false });
    const real = createAuthController({ api: authApi(), onLogin });
    real.setDraft({ patch: { username: 'admin', password: 'wrong' } });
    await real.submit({});
    expect(real.getSnapshot({}).error).not.toBe('login failed');
  });
});
