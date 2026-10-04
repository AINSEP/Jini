import { describe, it, expect } from 'vitest';
import { createMemoryRolesApi } from '../adapters/memory.js';
import { createRolesController } from '../controllers/roles.controller.js';
import { describeRolesError } from '../rules.js';
import { RolesApiError } from '../ports.js';
import type { RoleRecord, PolicyRecord } from '../models.js';
const role: RoleRecord = { id: 'r', workspaceId: 'w', name: 'builtin', isBuiltin: true };
const policy: PolicyRecord = { id: 'p', workspaceId: 'w', name: 'frozen', isBuiltin: false, isFrozen: true };
describe('memory server contract', () => {
    it('denies every mutation without a server grant even if the controller has a client grant', async () => {
        const api = createMemoryRolesApi({ workspaceId: 'w' }, { roles: [role], policies: [policy] });
        const writes = [() => api.createRole({ name: 'x' }), () => api.updateRole({ roleId: 'r', name: 'x' }), () => api.deleteRole({ roleId: 'r' }),
            () => api.createPolicy({ name: 'x' }), () => api.updatePolicy({ policyId: 'p' }, { name: 'x' }), () => api.deletePolicy({ policyId: 'p' }),
            () => api.writePolicyPermission({ policyId: 'p', permission: 'content.read' }), () => api.removePolicyPermission({ policyId: 'p', policyPermissionId: 'g' })];
        for (const write of writes)
            await expect(write()).rejects.toMatchObject({ code: 'FORBIDDEN' });
        const c = createRolesController({ api }, { permissions: ['role.manage'] });
        await c.load({});
        c.setDraft({ patch: { roleName: 'x' } });
        expect(await c.createRole({})).toBe(false);
        expect(c.getSnapshot().roleError).toBe('You do not have permission to do that.');
        c.dispose({});
    });
    it('protects immutable records, live references, the catalog and issuer authority', async () => {
        const custom = { ...role, id: 'custom', name: 'custom', isBuiltin: false };
        const live = { ...policy, id: 'live', name: 'live', isFrozen: false };
        const api = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage'], roles: [role, custom], policies: [policy, live], referencedRoleIds: ['custom'], referencedPolicyIds: ['live'] });
        await expect(api.deleteRole({ roleId: 'r' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(api.updatePolicy({ policyId: 'p' }, { name: 'changed' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(api.deleteRole({ roleId: 'custom' })).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
        await expect(api.deletePolicy({ policyId: 'live' })).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
        await expect(api.writePolicyPermission({ policyId: 'live', permission: 'unknown.permission' })).rejects.toMatchObject({ code: 'PERMISSION_UNKNOWN' });
        await expect(api.writePolicyPermission({ policyId: 'live', permission: 'content.read' })).rejects.toMatchObject({ code: 'GRANT_EXCEEDS_ISSUER' });
        await expect(api.createRole({ name: '  ' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(api.createRole({ name: 'CUSTOM' })).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
    });
    it('filters foreign workspaces, snapshots seed data, and does not widen scoped grants', async () => {
        const seed = { ...policy, isFrozen: false };
        const api = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage', 'content.read'], policies: [seed, { ...seed, id: 'foreign', workspaceId: 'other' }] });
        seed.name = 'tampered';
        expect((await api.listPolicies({})).policies.map(p => p.name)).toEqual(['frozen']);
        await expect(api.deletePolicy({ policyId: 'foreign' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
        const a = await api.writePolicyPermission({ policyId: 'p', permission: 'content.read' }, { resourceType: 'article' });
        const b = await api.writePolicyPermission({ policyId: 'p', permission: 'content.read' }, { resourceType: 'article' });
        expect(b.policyPermission.id).not.toBe(a.policyPermission.id);
        expect((await api.listPolicyPermissions({ policyId: 'p' })).policyPermissions[0]!.resourceType).toBe('article');
    });
    it('keeps feature-specific structured error explanations', () => {
        const messages = { FORBIDDEN: 'You do not have permission to do that.', RESOURCE_CONFLICT: 'It is still in use — remove that assignment/attachment first.', PERMISSION_UNKNOWN: 'That permission is not recognized.', GRANT_EXCEEDS_ISSUER: 'You cannot grant a permission you do not hold.', VALIDATION_ERROR: 'server detail' };
        for (const [code, message] of Object.entries(messages))
            expect(describeRolesError({ error: new RolesApiError({ code, message: 'server detail' }), fallback: 'fallback' })).toBe(message);
        expect(describeRolesError({ error: new Error('diagnostic'), fallback: 'fallback' })).toBe('diagnostic');
    });
});
