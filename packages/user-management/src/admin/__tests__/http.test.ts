import { expect, it } from 'vitest';
import { createHttpRolesApi } from '../adapters/http.js';
import { RolesApiError } from '../ports.js';
import type { RolesHttpTransport } from '../ports.js';
it('matches all workspace wire routes, encodes ids, preserves empty patches and forwards aborts', async () => {
    const calls: unknown[] = [];
    const transport: RolesHttpTransport = { async request<T>(r: Parameters<RolesHttpTransport['request']>[0], o?: Parameters<RolesHttpTransport['request']>[1]) { calls.push([r, o]); return {} as T; } };
    const api = createHttpRolesApi({ transport, workspaceId: 'a/b' });
    const signal = new AbortController().signal;
    await api.listRoles({}, { signal });
    await api.listPolicies({});
    await api.createRole({ name: 'r' });
    await api.updateRole({ roleId: 'r/1', name: 'new' });
    await api.deleteRole({ roleId: 'r/1' });
    await api.createPolicy({ name: 'p' }, { description: 'd' });
    await api.updatePolicy({ policyId: 'p/1' }, { description: '' });
    await api.deletePolicy({ policyId: 'p/1' });
    await api.listPolicyPermissions({ policyId: 'p/1' });
    await api.writePolicyPermission({ policyId: 'p/1', permission: 'content.read' }, { resourceType: 'article' });
    await api.removePolicyPermission({ policyId: 'p/1', policyPermissionId: 'g/1' });
    expect(calls).toEqual([
        [{ path: '/workspaces/a%2Fb/roles', method: 'GET' }, { signal }], [{ path: '/workspaces/a%2Fb/policies', method: 'GET' }, {}],
        [{ path: '/workspaces/a%2Fb/roles', method: 'POST', body: { name: 'r' } }, {}],
        [{ path: '/workspaces/a%2Fb/roles/r%2F1', method: 'PATCH', body: { name: 'new' } }, {}], [{ path: '/workspaces/a%2Fb/roles/r%2F1', method: 'DELETE' }, {}],
        [{ path: '/workspaces/a%2Fb/policies', method: 'POST', body: { name: 'p', description: 'd' } }, {}],
        [{ path: '/workspaces/a%2Fb/policies/p%2F1', method: 'PATCH', body: { description: '' } }, {}],
        [{ path: '/workspaces/a%2Fb/policies/p%2F1', method: 'DELETE' }, {}], [{ path: '/workspaces/a%2Fb/policies/p%2F1/permissions', method: 'GET' }, {}],
        [{ path: '/workspaces/a%2Fb/policies/p%2F1/permissions', method: 'POST', body: { permission: 'content.read', resourceType: 'article' } }, {}],
        [{ path: '/workspaces/a%2Fb/policies/p%2F1/permissions/g%2F1', method: 'DELETE' }, {}],
    ]);
    const abort = new AbortController();
    abort.abort();
    await expect(api.createRole({ name: 'blocked' }, { signal: abort.signal })).rejects.toThrow();
    expect(calls).toHaveLength(11);
});
it('supports a host API prefix and preserves structured transport failures', async () => {
    const error = new RolesApiError({ code: 'FORBIDDEN', message: 'server denied' });
    let path = '';
    const api = createHttpRolesApi({ workspaceId: 'w', transport: { async request(r) { path = r.path; throw error; } } }, { basePath: '/api/workspaces/' });
    await expect(api.createRole({ name: 'x' })).rejects.toBe(error);
    expect(path).toBe('/api/workspaces/w/roles');
});
