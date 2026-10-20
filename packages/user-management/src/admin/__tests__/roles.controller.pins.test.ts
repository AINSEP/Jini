import { describe, it, expect, vi } from 'vitest';
import { createMemoryRolesApi } from '../adapters/memory.js';
import { createRolesController } from '../controllers/roles.controller.js';
import { RolesApiError } from '../ports.js';
import type { RolesApiPort } from '../ports.js';
import type { RoleRecord, PolicyRecord, PolicyPermissionRecord, RolesState } from '../models.js';
import { rolesMessagesEn as m } from '../messages.en.js';

const deferred = <T>() => { let resolve!: (v: T) => void; let reject!: (v: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const role: RoleRecord = { id: 'r1', workspaceId: 'w', name: 'Writer', isBuiltin: false };
const builtinRole: RoleRecord = { id: 'rb', workspaceId: 'w', name: 'Owner', isBuiltin: true };
const policy: PolicyRecord = { id: 'p1', workspaceId: 'w', name: 'Read', isBuiltin: false, isFrozen: false };
const policy2: PolicyRecord = { id: 'p2', workspaceId: 'w', name: 'Write', isBuiltin: false, isFrozen: false, description: 'd' };
const builtinPolicy: PolicyRecord = { id: 'pb', workspaceId: 'w', name: 'All', isBuiltin: true, isFrozen: false };
const frozenPolicy: PolicyRecord = { id: 'pf', workspaceId: 'w', name: 'Frozen', isBuiltin: false, isFrozen: true };
const grant: PolicyPermissionRecord = { id: 'g1', workspaceId: 'w', policyId: 'p1', permission: 'content.read', resourceType: null };
const MANAGE = { permissions: ['role.manage'] };

function memory() {
    return createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['*'], catalog: ['content.read', 'content.write'], roles: [role, builtinRole], policies: [policy, policy2, builtinPolicy, frozenPolicy], policyPermissions: [grant] });
}
async function setup(overrides: Partial<RolesApiPort> = {}, grants: { permissions?: string[] } = MANAGE) {
    const base = memory();
    const api: RolesApiPort = { ...base, ...overrides };
    const c = createRolesController({ api }, grants);
    await c.load({});
    return { base, api, c };
}
/** setDraft forwards its patch unfiltered: a Partial<RolesState> is structurally a Partial<RolesDraft>.
 * This is the only route by which busy/pending fields change under an in-flight write. */
const forcePatch = (patch: Partial<RolesState>) => patch;

describe('roles controller writePermission pins', () => {
    it('refuses without an open panel and makes no call', async () => {
        const write = vi.fn<RolesApiPort['writePolicyPermission']>();
        const { c } = await setup({ writePolicyPermission: write });
        c.setDraft({ patch: { permissionInput: 'content.read' } });
        expect(await c.writePermission({})).toBe(false);
        expect(write).not.toHaveBeenCalled();
        c.dispose({});
    });
    it('refuses an empty permission without touching rowError', async () => {
        const write = vi.fn<RolesApiPort['writePolicyPermission']>();
        const { c } = await setup({ writePolicyPermission: write });
        await c.togglePermissions({ policyId: 'p1' });
        expect(await c.writePermission({})).toBe(false);
        expect(write).not.toHaveBeenCalled();
        expect(c.getSnapshot().rowError).toBeNull();
        c.dispose({});
    });
    it('refuses without role.manage and reports forbidden', async () => {
        const write = vi.fn<RolesApiPort['writePolicyPermission']>();
        const { c } = await setup({ writePolicyPermission: write }, {});
        await c.togglePermissions({ policyId: 'p1' });
        c.setDraft({ patch: { permissionInput: 'content.read' } });
        expect(await c.writePermission({})).toBe(false);
        expect(c.getSnapshot().rowError).toBe(m.forbidden);
        expect(write).not.toHaveBeenCalled();
        c.dispose({});
    });
    it('accepts the wildcard grant as role.manage', async () => {
        const { c } = await setup({}, { permissions: ['*'] });
        await c.togglePermissions({ policyId: 'p1' });
        c.setDraft({ patch: { permissionInput: 'content.write' } });
        expect(await c.writePermission({})).toBe(true);
        c.dispose({});
    });
    it.each([['pb'], ['pf']])('refuses a built-in or frozen policy %s with the immutable message', async (policyId) => {
        const write = vi.fn<RolesApiPort['writePolicyPermission']>();
        const { c } = await setup({ writePolicyPermission: write });
        await c.togglePermissions({ policyId });
        c.setDraft({ patch: { permissionInput: 'content.read' } });
        expect(await c.writePermission({})).toBe(false);
        expect(c.getSnapshot().rowError).toBe(m.immutable);
        expect(write).not.toHaveBeenCalled();
        c.dispose({});
    });
    it('refuses when the open policy is no longer listed, silently', async () => {
        const write = vi.fn<RolesApiPort['writePolicyPermission']>();
        const { base, c } = await setup({ writePolicyPermission: write });
        await c.togglePermissions({ policyId: 'p1' });
        await base.deletePolicy({ policyId: 'p1' });
        await c.load({});
        c.setDraft({ patch: { permissionInput: 'content.read' } });
        expect(await c.writePermission({})).toBe(false);
        expect(c.getSnapshot().rowError).toBeNull();
        expect(write).not.toHaveBeenCalled();
        c.dispose({});
    });
    it('refuses a second write while one is in flight', async () => {
        const gate = deferred<void>();
        const base = memory();
        const write = vi.fn<RolesApiPort['writePolicyPermission']>(async (r, o) => { await gate.promise; return base.writePolicyPermission(r, o); });
        const c = createRolesController({ api: { ...base, writePolicyPermission: write } }, MANAGE);
        await c.load({});
        await c.togglePermissions({ policyId: 'p1' });
        c.setDraft({ patch: { permissionInput: 'content.write' } });
        const first = c.writePermission({});
        expect(c.getSnapshot().rowSavingId).toBe('p1');
        expect(await c.writePermission({})).toBe(false);
        gate.resolve();
        expect(await first).toBe(true);
        expect(write).toHaveBeenCalledTimes(1);
        expect(c.getSnapshot().rowSavingId).toBeNull();
        c.dispose({});
    });
    it('refuses while a destructive confirmation is in flight', async () => {
        const gate = deferred<void>();
        const write = vi.fn<RolesApiPort['writePolicyPermission']>();
        const { c } = await setup({ writePolicyPermission: write, deleteRole: async () => { await gate.promise; } });
        await c.togglePermissions({ policyId: 'p1' });
        c.setDraft({ patch: { permissionInput: 'content.read' } });
        c.requestDestructive({ target: { kind: 'role', role } });
        const confirm = c.confirmDestructive({});
        expect(await c.writePermission({})).toBe(false);
        expect(write).not.toHaveBeenCalled();
        gate.resolve();
        await confirm;
        c.dispose({});
    });
    it('refuses after dispose', async () => {
        const write = vi.fn<RolesApiPort['writePolicyPermission']>();
        const { c } = await setup({ writePolicyPermission: write });
        await c.togglePermissions({ policyId: 'p1' });
        c.setDraft({ patch: { permissionInput: 'content.read' } });
        c.dispose({});
        expect(await c.writePermission({})).toBe(false);
        expect(write).not.toHaveBeenCalled();
    });
    it('omits an empty resourceType and passes a set one', async () => {
        const base = memory();
        const write = vi.fn<RolesApiPort['writePolicyPermission']>((r, o) => base.writePolicyPermission(r, o));
        const c = createRolesController({ api: { ...base, writePolicyPermission: write } }, MANAGE);
        await c.load({});
        await c.togglePermissions({ policyId: 'p2' });
        c.setDraft({ patch: { permissionInput: 'content.read' } });
        await c.writePermission({});
        expect(write.mock.calls[0]![0]).toEqual({ policyId: 'p2', permission: 'content.read' });
        expect(Object.keys(write.mock.calls[0]![1]!)).toEqual(['signal']);
        c.setDraft({ patch: { permissionInput: 'content.write', resourceTypeInput: 'article' } });
        await c.writePermission({});
        expect(write.mock.calls[1]![1]).toMatchObject({ resourceType: 'article' });
        c.dispose({});
    });
    it('on success clears both inputs, reloads the open panel and returns true', async () => {
        const { c } = await setup();
        await c.togglePermissions({ policyId: 'p1' });
        c.setDraft({ patch: { permissionInput: 'content.write', resourceTypeInput: 'article' } });
        expect(await c.writePermission({})).toBe(true);
        const s = c.getSnapshot();
        expect(s.permissionInput).toBe('');
        expect(s.resourceTypeInput).toBe('');
        expect(s.permissionRows.map(r => r.permission)).toEqual(['content.read', 'content.write']);
        expect(s.rowSavingId).toBeNull();
        c.dispose({});
    });
    it.each([
        ['permissionInput', { permissionInput: 'newer' }],
        ['resourceTypeInput', { resourceTypeInput: 'newer' }],
    ] as const)('preserves a newer %s draft typed during the write', async (_name, patch) => {
        const gate = deferred<void>();
        const base = memory();
        const c = createRolesController({ api: { ...base, writePolicyPermission: async (r, o) => { await gate.promise; return base.writePolicyPermission(r, o); } } }, MANAGE);
        await c.load({});
        await c.togglePermissions({ policyId: 'p1' });
        c.setDraft({ patch: { permissionInput: 'content.write', resourceTypeInput: 'article' } });
        const pending = c.writePermission({});
        c.setDraft({ patch });
        gate.resolve();
        expect(await pending).toBe(true);
        expect(c.getSnapshot()).toMatchObject({ permissionInput: 'content.write', resourceTypeInput: 'article', ...patch });
        c.dispose({});
    });
    it('does not clear an identical draft on a reopened panel (panel generation owns clearing)', async () => {
        const gate = deferred<void>();
        const base = memory();
        const c = createRolesController({ api: { ...base, writePolicyPermission: async (r, o) => { await gate.promise; return base.writePolicyPermission(r, o); } } }, MANAGE);
        await c.load({});
        await c.togglePermissions({ policyId: 'p1' });
        c.setDraft({ patch: { permissionInput: 'content.write' } });
        const pending = c.writePermission({});
        await c.togglePermissions({ policyId: 'p1' });
        await c.togglePermissions({ policyId: 'p1' });
        c.setDraft({ patch: { permissionInput: 'content.write' } });
        gate.resolve();
        expect(await pending).toBe(true);
        expect(c.getSnapshot().permissionInput).toBe('content.write');
        c.dispose({});
    });
    it('skips the refresh when the panel was closed during the write', async () => {
        const gate = deferred<void>();
        const base = memory();
        const list = vi.fn<RolesApiPort['listPolicyPermissions']>((r, o) => base.listPolicyPermissions(r, o));
        const c = createRolesController({ api: { ...base, listPolicyPermissions: list, writePolicyPermission: async (r, o) => { await gate.promise; return base.writePolicyPermission(r, o); } } }, MANAGE);
        await c.load({});
        await c.togglePermissions({ policyId: 'p1' });
        c.setDraft({ patch: { permissionInput: 'content.write' } });
        const pending = c.writePermission({});
        await c.togglePermissions({ policyId: 'p1' });
        gate.resolve();
        expect(await pending).toBe(true);
        expect(list).toHaveBeenCalledTimes(1);
        expect(c.getSnapshot().permissionPolicyId).toBeNull();
        c.dispose({});
    });
    it('returns false when disposed during the write', async () => {
        const gate = deferred<void>();
        const base = memory();
        const c = createRolesController({ api: { ...base, writePolicyPermission: async () => { await gate.promise; return { policyPermission: grant }; } } }, MANAGE);
        await c.load({});
        await c.togglePermissions({ policyId: 'p1' });
        c.setDraft({ patch: { permissionInput: 'content.write' } });
        const pending = c.writePermission({});
        c.dispose({});
        gate.resolve();
        expect(await pending).toBe(false);
    });
    it('maps a coded failure, keeps the draft, and clears the busy row', async () => {
        const { c } = await setup({ writePolicyPermission: async () => { throw new RolesApiError({ code: 'PERMISSION_UNKNOWN', message: 'nope' }); } });
        await c.togglePermissions({ policyId: 'p1' });
        c.setDraft({ patch: { permissionInput: 'bogus' } });
        expect(await c.writePermission({})).toBe(false);
        expect(c.getSnapshot()).toMatchObject({ rowError: m.unknownPermission, permissionInput: 'bogus', rowSavingId: null });
        c.dispose({});
    });
    it('uses the add-permission fallback for an uncoded, message-less failure', async () => {
        const { c } = await setup({ writePolicyPermission: async () => { throw { reason: 'opaque' }; } });
        await c.togglePermissions({ policyId: 'p1' });
        c.setDraft({ patch: { permissionInput: 'content.write' } });
        expect(await c.writePermission({})).toBe(false);
        expect(c.getSnapshot().rowError).toBe('Failed to add permission.');
        c.dispose({});
    });
    it('leaves a foreign busy row alone when it settles', async () => {
        const gate = deferred<void>();
        const base = memory();
        const c = createRolesController({ api: { ...base, writePolicyPermission: async () => { await gate.promise; throw new Error('boom'); } } }, MANAGE);
        await c.load({});
        await c.togglePermissions({ policyId: 'p1' });
        c.setDraft({ patch: { permissionInput: 'content.write' } });
        const pending = c.writePermission({});
        c.setDraft({ patch: forcePatch({ rowSavingId: 'other' }) });
        gate.resolve();
        expect(await pending).toBe(false);
        expect(c.getSnapshot()).toMatchObject({ rowSavingId: 'other', rowError: 'boom' });
        c.dispose({});
    });
});

describe('roles controller confirmDestructive pins', () => {
    it('refuses with nothing pending', async () => {
        const { c } = await setup();
        expect(await c.confirmDestructive({})).toBe(false);
        c.dispose({});
    });
    it('refuses while a row write is in flight', async () => {
        const gate = deferred<void>();
        const del = vi.fn<RolesApiPort['deleteRole']>();
        const { c } = await setup({ deleteRole: del, updateRole: async () => { await gate.promise; return { role }; } });
        c.editRole({ role });
        c.setDraft({ patch: { editingRoleName: 'x' } });
        c.requestDestructive({ target: { kind: 'role', role } });
        const save = c.saveRole({});
        expect(await c.confirmDestructive({})).toBe(false);
        expect(del).not.toHaveBeenCalled();
        gate.resolve();
        await save;
        c.dispose({});
    });
    it('refuses when the pending role vanished from the list', async () => {
        const del = vi.fn<RolesApiPort['deleteRole']>();
        const { base, c } = await setup({ deleteRole: del });
        c.requestDestructive({ target: { kind: 'role', role } });
        await base.deleteRole({ roleId: 'r1' });
        await c.load({});
        expect(await c.confirmDestructive({})).toBe(false);
        expect(del).not.toHaveBeenCalled();
        expect(c.getSnapshot().pending).not.toBeNull();
        c.dispose({});
    });
    it('refuses after dispose', async () => {
        const del = vi.fn<RolesApiPort['deleteRole']>();
        const { c } = await setup({ deleteRole: del });
        c.requestDestructive({ target: { kind: 'role', role } });
        c.dispose({});
        expect(await c.confirmDestructive({})).toBe(false);
        expect(del).not.toHaveBeenCalled();
    });
    it('deletes a role, reloads, clears pending and returns true', async () => {
        const { c } = await setup();
        c.requestDestructive({ target: { kind: 'role', role } });
        expect(await c.confirmDestructive({})).toBe(true);
        expect(c.getSnapshot().roles!.map(r => r.id)).toEqual(['rb']);
        expect(c.getSnapshot()).toMatchObject({ pending: null, confirming: false, rowError: null });
        c.dispose({});
    });
    it('deleting the policy whose panel is open closes it and drops an in-flight panel read', async () => {
        const read = deferred<{ policyPermissions: PolicyPermissionRecord[] }>();
        const base = memory();
        let calls = 0;
        const c = createRolesController({ api: { ...base, listPolicyPermissions: async (r, o) => (++calls === 1 ? base.listPolicyPermissions(r, o) : read.promise) } }, MANAGE);
        await c.load({});
        await c.togglePermissions({ policyId: 'p1' });
        const reload = c.loadPermissions({ policyId: 'p1' });
        c.requestDestructive({ target: { kind: 'policy', policy } });
        expect(await c.confirmDestructive({})).toBe(true);
        read.resolve({ policyPermissions: [grant] });
        await reload;
        expect(c.getSnapshot()).toMatchObject({ permissionPolicyId: null, permissionRows: [], permissionsLoading: false });
        expect(c.getSnapshot().policies!.map(p => p.id)).toEqual(['p2', 'pb', 'pf']);
        c.dispose({});
    });
    it('deleting another policy keeps the open panel', async () => {
        const { c } = await setup();
        await c.togglePermissions({ policyId: 'p1' });
        c.requestDestructive({ target: { kind: 'policy', policy: policy2 } });
        expect(await c.confirmDestructive({})).toBe(true);
        expect(c.getSnapshot().permissionPolicyId).toBe('p1');
        expect(c.getSnapshot().permissionRows).toHaveLength(1);
        c.dispose({});
    });
    it('removing a permission marks the row while in flight and reloads the open panel', async () => {
        const gate = deferred<void>();
        const base = memory();
        const c = createRolesController({ api: { ...base, removePolicyPermission: async (r, o) => { await gate.promise; return base.removePolicyPermission(r, o); } } }, MANAGE);
        await c.load({});
        await c.togglePermissions({ policyId: 'p1' });
        c.requestDestructive({ target: { kind: 'permission', policyId: 'p1', row: grant } });
        const pending = c.confirmDestructive({});
        expect(c.getSnapshot()).toMatchObject({ removingPermissionId: 'g1', confirming: true });
        gate.resolve();
        expect(await pending).toBe(true);
        expect(c.getSnapshot()).toMatchObject({ removingPermissionId: null, permissionRows: [], pending: null });
        c.dispose({});
    });
    it('removing a permission after its panel closed skips the reload', async () => {
        const gate = deferred<void>();
        const base = memory();
        const list = vi.fn<RolesApiPort['listPolicyPermissions']>((r, o) => base.listPolicyPermissions(r, o));
        const c = createRolesController({ api: { ...base, listPolicyPermissions: list, removePolicyPermission: async (r, o) => { await gate.promise; return base.removePolicyPermission(r, o); } } }, MANAGE);
        await c.load({});
        await c.togglePermissions({ policyId: 'p1' });
        c.requestDestructive({ target: { kind: 'permission', policyId: 'p1', row: grant } });
        const pending = c.confirmDestructive({});
        await c.togglePermissions({ policyId: 'p1' });
        gate.resolve();
        expect(await pending).toBe(true);
        expect(list).toHaveBeenCalledTimes(1);
        c.dispose({});
    });
    it.each([
        ['role', 'Failed to delete role.'],
        ['policy', 'Failed to delete policy.'],
        ['permission', 'Failed to remove permission.'],
    ] as const)('a failed %s write reports its fallback, closes the dialog and returns false', async (kind, message) => {
        const fail = async () => { throw { opaque: true }; };
        const { c } = await setup({ deleteRole: fail, deletePolicy: fail, removePolicyPermission: fail });
        await c.togglePermissions({ policyId: 'p1' });
        const target = kind === 'role' ? { kind, role } : kind === 'policy' ? { kind, policy } : { kind, policyId: 'p1', row: grant };
        c.requestDestructive({ target });
        expect(await c.confirmDestructive({})).toBe(false);
        expect(c.getSnapshot()).toMatchObject({ rowError: message, pending: null, confirming: false, removingPermissionId: null });
        c.dispose({});
    });
    it('maps a conflict code to the in-use copy', async () => {
        const { c } = await setup({ deleteRole: async () => { throw new RolesApiError({ code: 'RESOURCE_CONFLICT', message: 'x' }); } });
        c.requestDestructive({ target: { kind: 'role', role } });
        expect(await c.confirmDestructive({})).toBe(false);
        expect(c.getSnapshot().rowError).toBe(m.conflict);
        c.dispose({});
    });
    it('returns false when disposed during the delete', async () => {
        const gate = deferred<void>();
        const { c } = await setup({ deletePolicy: async () => { await gate.promise; } });
        c.requestDestructive({ target: { kind: 'policy', policy } });
        const pending = c.confirmDestructive({});
        c.dispose({});
        gate.resolve();
        expect(await pending).toBe(false);
    });
    it('keeps a replaced pending target when the old confirmation settles', async () => {
        const gate = deferred<void>();
        const { c } = await setup({ deleteRole: async () => { await gate.promise; } });
        c.requestDestructive({ target: { kind: 'role', role } });
        const pending = c.confirmDestructive({});
        const replacement = { kind: 'policy', policy } as const;
        c.setDraft({ patch: forcePatch({ pending: replacement }) });
        gate.resolve();
        expect(await pending).toBe(true);
        expect(c.getSnapshot()).toMatchObject({ pending: replacement, confirming: false });
        c.dispose({});
    });
});

describe('roles controller requestDestructive and remaining pins', () => {
    it('captures a frozen copy of the target', async () => {
        const { c } = await setup();
        const mutable = { ...role };
        c.requestDestructive({ target: { kind: 'role', role: mutable } });
        mutable.name = 'changed';
        const pending = c.getSnapshot().pending!;
        expect(pending).toEqual({ kind: 'role', role });
        expect(Object.isFrozen(pending)).toBe(true);
        // A second request replaces the first: only an in-flight confirmation blocks requests.
        c.requestDestructive({ target: { kind: 'policy', policy } });
        expect(c.getSnapshot().pending).toEqual({ kind: 'policy', policy });
        expect(Object.isFrozen(c.getSnapshot().pending)).toBe(true);
        c.dispose({});
    });
    it('refuses a permission target whose panel is not open or whose row is not listed', async () => {
        const { c } = await setup();
        c.requestDestructive({ target: { kind: 'permission', policyId: 'p1', row: grant } });
        expect(c.getSnapshot().pending).toBeNull();
        await c.togglePermissions({ policyId: 'p1' });
        c.requestDestructive({ target: { kind: 'permission', policyId: 'p1', row: { ...grant, id: 'missing' } } });
        expect(c.getSnapshot().pending).toBeNull();
        c.requestDestructive({ target: { kind: 'permission', policyId: 'p1', row: grant } });
        expect(c.getSnapshot().pending).toEqual({ kind: 'permission', policyId: 'p1', row: grant });
        c.dispose({});
    });
    it('refuses built-in role and frozen policy targets with the immutable message', async () => {
        const { c } = await setup();
        c.requestDestructive({ target: { kind: 'role', role: builtinRole } });
        expect(c.getSnapshot()).toMatchObject({ pending: null, rowError: m.immutable });
        c.requestDestructive({ target: { kind: 'policy', policy: frozenPolicy } });
        expect(c.getSnapshot()).toMatchObject({ pending: null, rowError: m.immutable });
        c.dispose({});
    });
    it('edit refuses immutable rows and copies an absent description as empty', async () => {
        const { c } = await setup();
        c.editRole({ role: builtinRole });
        expect(c.getSnapshot()).toMatchObject({ editingRoleId: null, rowError: m.immutable });
        c.editPolicy({ policy: builtinPolicy });
        expect(c.getSnapshot()).toMatchObject({ editingPolicyId: null, rowError: m.immutable });
        c.editPolicy({ policy });
        expect(c.getSnapshot()).toMatchObject({ editingPolicyId: 'p1', editingPolicyDescription: '', rowError: null });
        c.editPolicy({ policy: policy2 });
        expect(c.getSnapshot().editingPolicyDescription).toBe('d');
        c.cancelEdit({ kind: 'policy' });
        c.editRole({ role });
        c.cancelEdit({ kind: 'role' });
        expect(c.getSnapshot()).toMatchObject({ editingRoleId: null, editingPolicyId: null });
        c.dispose({});
    });
    it('load drops a stale success and reports a current failure', async () => {
        const first = deferred<{ roles: RoleRecord[] }>();
        const base = memory();
        let n = 0;
        const c = createRolesController({ api: { ...base, listRoles: async (r, o) => (++n === 1 ? first.promise : base.listRoles(r, o)) } }, MANAGE);
        const stale = c.load({});
        await c.load({});
        first.resolve({ roles: [] });
        await stale;
        expect(c.getSnapshot().roles).toHaveLength(2);
        const failing = createRolesController({ api: { ...base, listPolicies: async () => { throw new Error('down'); } } }, MANAGE);
        await failing.load({});
        expect(failing.getSnapshot().error).toBe('down');
        c.dispose({});
        failing.dispose({});
    });
    it('load drops a stale failure and is inert after dispose', async () => {
        const first = deferred<{ roles: RoleRecord[] }>();
        const base = memory();
        let n = 0;
        const list = vi.fn<RolesApiPort['listRoles']>(async (r, o) => (++n === 1 ? first.promise : base.listRoles(r, o)));
        const c = createRolesController({ api: { ...base, listRoles: list } }, MANAGE);
        const stale = c.load({});
        await c.load({});
        first.reject(new Error('stale'));
        await stale;
        expect(c.getSnapshot().error).toBeNull();
        c.dispose({});
        await c.load({});
        expect(list).toHaveBeenCalledTimes(2);
    });
    it('loadPermissions ignores a non-open policy, reports failure on the open one, and is inert after dispose', async () => {
        const list = vi.fn<RolesApiPort['listPolicyPermissions']>(async () => { throw new Error('perm down'); });
        const { c } = await setup({ listPolicyPermissions: list });
        await c.loadPermissions({ policyId: 'p1' });
        expect(list).not.toHaveBeenCalled();
        await c.togglePermissions({ policyId: 'p1' });
        expect(c.getSnapshot()).toMatchObject({ rowError: 'perm down', permissionRows: [], permissionsLoading: false });
        c.dispose({});
        await c.loadPermissions({ policyId: 'p1' });
        expect(list).toHaveBeenCalledTimes(1);
    });
    it('loadPermissions drops a settlement after its panel switched', async () => {
        const read = deferred<{ policyPermissions: PolicyPermissionRecord[] }>();
        const base = memory();
        const c = createRolesController({ api: { ...base, listPolicyPermissions: async (r, o) => (r.policyId === 'p1' ? read.promise : base.listPolicyPermissions(r, o)) } }, MANAGE);
        await c.load({});
        const first = c.togglePermissions({ policyId: 'p1' });
        await c.togglePermissions({ policyId: 'p2' });
        read.resolve({ policyPermissions: [grant] });
        await first;
        expect(c.getSnapshot()).toMatchObject({ permissionPolicyId: 'p2', permissionRows: [] });
        c.dispose({});
    });
    it('togglePermissions ignores an unknown policy and a disposed controller', async () => {
        const list = vi.fn<RolesApiPort['listPolicyPermissions']>();
        const { c } = await setup({ listPolicyPermissions: list });
        await c.togglePermissions({ policyId: 'nope' });
        expect(c.getSnapshot().permissionPolicyId).toBeNull();
        c.dispose({});
        await c.togglePermissions({ policyId: 'p1' });
        expect(list).not.toHaveBeenCalled();
    });
    it('createRole keeps a newer name, reports failures and refuses while saving', async () => {
        const gate = deferred<void>();
        const base = memory();
        const create = vi.fn<RolesApiPort['createRole']>(async (r, o) => { await gate.promise; return base.createRole(r, o); });
        const c = createRolesController({ api: { ...base, createRole: create } }, MANAGE);
        await c.load({});
        c.setDraft({ patch: { roleName: 'Editors' } });
        const pending = c.createRole({});
        expect(await c.createRole({})).toBe(false);
        c.setDraft({ patch: { roleName: 'Newer' } });
        gate.resolve();
        expect(await pending).toBe(true);
        expect(c.getSnapshot()).toMatchObject({ roleName: 'Newer', roleSaving: false });
        expect(create).toHaveBeenCalledTimes(1);
        expect(await c.createRole({})).toBe(true);
        expect(await c.createRole({})).toBe(false);
        expect(c.getSnapshot().roleError).toBe('Name is required.');
        c.dispose({});
    });
    it('createPolicy omits an empty description, keeps a newer draft, reports failures and refuses while saving', async () => {
        const gate = deferred<void>();
        const base = memory();
        const create = vi.fn<RolesApiPort['createPolicy']>(async (r, o) => { await gate.promise; return base.createPolicy(r, o); });
        const c = createRolesController({ api: { ...base, createPolicy: create } }, MANAGE);
        await c.load({});
        c.setDraft({ patch: { policyName: 'Viewers' } });
        const pending = c.createPolicy({});
        expect(await c.createPolicy({})).toBe(false);
        c.setDraft({ patch: { policyDescription: 'typed later' } });
        gate.resolve();
        expect(await pending).toBe(true);
        expect(Object.keys(create.mock.calls[0]![1]!)).toEqual(['signal']);
        expect(c.getSnapshot()).toMatchObject({ policyName: 'Viewers', policyDescription: 'typed later', policySaving: false });
        c.setDraft({ patch: { policyName: 'Viewers2' } });
        expect(await c.createPolicy({})).toBe(true);
        expect(create.mock.calls[1]![1]).toMatchObject({ description: 'typed later' });
        expect(await c.createPolicy({})).toBe(false);
        expect(c.getSnapshot().policyError).toBe('Name is required.');
        c.dispose({});
    });
    it('saveRole and savePolicy report failures with their fallbacks', async () => {
        const fail = async () => { throw {}; };
        const { c } = await setup({ updateRole: fail, updatePolicy: fail });
        expect(await c.saveRole({})).toBe(false);
        c.editRole({ role });
        expect(await c.saveRole({})).toBe(false);
        expect(c.getSnapshot()).toMatchObject({ rowError: 'Failed to rename role.', rowSavingId: null, editingRoleId: 'r1' });
        expect(await c.savePolicy({})).toBe(false);
        c.editPolicy({ policy });
        expect(await c.savePolicy({})).toBe(false);
        expect(c.getSnapshot()).toMatchObject({ rowError: 'Failed to update policy.', rowSavingId: null, editingPolicyId: 'p1' });
        c.dispose({});
    });
    it('a late save keeps a newer edit open and refuses while another row saves', async () => {
        const gate = deferred<void>();
        const base = memory();
        const c = createRolesController({ api: { ...base, updatePolicy: async (r, o) => { await gate.promise; return base.updatePolicy(r, o); }, updateRole: async (r, o) => { await gate.promise; return base.updateRole(r, o); } } }, MANAGE);
        await c.load({});
        c.editPolicy({ policy });
        c.setDraft({ patch: { editingPolicyName: 'Read2' } });
        const savingPolicy = c.savePolicy({});
        expect(await c.savePolicy({})).toBe(false);
        c.setDraft({ patch: { editingPolicyDescription: 'newer' } });
        c.editRole({ role });
        c.setDraft({ patch: { editingRoleName: 'W2' } });
        expect(await c.saveRole({})).toBe(false);
        gate.resolve();
        expect(await savingPolicy).toBe(true);
        expect(c.getSnapshot().editingPolicyId).toBe('p1');
        const savingRole = c.saveRole({});
        c.setDraft({ patch: { editingRoleName: 'W3' } });
        expect(await savingRole).toBe(true);
        expect(c.getSnapshot().editingRoleId).toBe('r1');
        c.dispose({});
    });
    it('a save leaves a foreign busy row alone when it settles', async () => {
        const gate = deferred<void>();
        const base = memory();
        const c = createRolesController({ api: { ...base, updateRole: async (r, o) => { await gate.promise; return base.updateRole(r, o); }, updatePolicy: async (r, o) => { await gate.promise; return base.updatePolicy(r, o); } } }, MANAGE);
        await c.load({});
        c.editRole({ role });
        const savingRole = c.saveRole({});
        c.setDraft({ patch: forcePatch({ rowSavingId: 'other' }) });
        c.editPolicy({ policy });
        c.setDraft({ patch: forcePatch({ rowSavingId: null }) });
        const savingPolicy = c.savePolicy({});
        c.setDraft({ patch: forcePatch({ rowSavingId: 'other' }) });
        gate.resolve();
        await Promise.all([savingRole, savingPolicy]);
        expect(c.getSnapshot().rowSavingId).toBe('other');
        c.dispose({});
    });
    it('freezes rows, ignores subscribe and patches after dispose, and disposes once', async () => {
        const { c } = await setup();
        const listener = vi.fn();
        const off = c.subscribe({ listener });
        await c.togglePermissions({ policyId: 'p1' });
        expect(Object.isFrozen(c.getSnapshot().permissionRows)).toBe(true);
        expect(listener).toHaveBeenCalled();
        off();
        c.dispose({});
        c.dispose({});
        const late = vi.fn();
        c.subscribe({ listener: late })();
        c.setDraft({ patch: { roleName: 'late' } });
        expect(c.getSnapshot().roleName).toBe('');
        expect(late).not.toHaveBeenCalled();
    });
});
