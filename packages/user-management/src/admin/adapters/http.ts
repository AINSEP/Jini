import type { RolesApiPort, RolesHttpTransport, RolesCallOptions } from '../ports.js';
/** Host transport owns cookies/authentication, API prefix, typed errors and server authorization.
 * These resource routes intentionally retain their response envelopes and workspace scope. */
export function createHttpRolesApi({ transport, workspaceId }: {
    transport: RolesHttpTransport;
    workspaceId: string;
}, { basePath = '/workspaces' }: {
    basePath?: string;
} = {}): RolesApiPort {
    const root = `${basePath.replace(/\/$/, '')}/${encodeURIComponent(workspaceId)}`;
    const role = (id: string) => `${root}/roles/${encodeURIComponent(id)}`;
    const policy = (id: string) => `${root}/policies/${encodeURIComponent(id)}`;
    const request = async <T>(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', o: RolesCallOptions, body?: Record<string, unknown>) => {
        o.signal?.throwIfAborted();
        return transport.request<T>({ path, method, ...(body ? { body } : {}) }, o.signal ? { signal: o.signal } : {});
    };
    return {
        listRoles: (_r, o = {}) => request(`${root}/roles`, 'GET', o),
        listPolicies: (_r, o = {}) => request(`${root}/policies`, 'GET', o),
        createRole: (r, o = {}) => request(`${root}/roles`, 'POST', o, { name: r.name }),
        updateRole: (r, o = {}) => request(role(r.roleId), 'PATCH', o, { name: r.name }),
        deleteRole: (r, o = {}) => request(role(r.roleId), 'DELETE', o),
        createPolicy: (r, o = {}) => request(`${root}/policies`, 'POST', o, { name: r.name, ...(o.description !== undefined ? { description: o.description } : {}) }),
        updatePolicy: (r, o = {}) => request(policy(r.policyId), 'PATCH', o, { ...(o.name !== undefined ? { name: o.name } : {}), ...(o.description !== undefined ? { description: o.description } : {}) }),
        deletePolicy: (r, o = {}) => request(policy(r.policyId), 'DELETE', o),
        listPolicyPermissions: (r, o = {}) => request(`${policy(r.policyId)}/permissions`, 'GET', o),
        writePolicyPermission: (r, o = {}) => request(`${policy(r.policyId)}/permissions`, 'POST', o, { permission: r.permission, ...(o.resourceType ? { resourceType: o.resourceType } : {}) }),
        removePolicyPermission: (r, o = {}) => request(`${policy(r.policyId)}/permissions/${encodeURIComponent(r.policyPermissionId)}`, 'DELETE', o),
    };
}

/** All HTTP adapters use the same public host transport. No fetch global or auth policy leaks in. */
export function createHttpUsersApi({ transport, workspaceId }: { transport: RolesHttpTransport; workspaceId: string }, { basePath = '/workspaces', authPath = '/auth' }: { basePath?: string; authPath?: string } = {}): import('../ports.js').UsersApiPort {
  const root = `${basePath.replace(/\/$/, '')}/${encodeURIComponent(workspaceId)}`;
  const user = (id: string) => `${root}/users/${encodeURIComponent(id)}`;
  const request = async <T>(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', o: RolesCallOptions, body?: Record<string, unknown>) => {
    o.signal?.throwIfAborted();
    return transport.request<T>({ path, method, ...(body ? { body } : {}) }, o.signal ? { signal: o.signal } : {});
  };
  return {
    listUsers: (_r, o = {}) => request(`${root}/users`, 'GET', o),
    listRoles: (_r, o = {}) => request(`${root}/roles`, 'GET', o),
    listPolicies: (_r, o = {}) => request(`${root}/policies`, 'GET', o),
    me: (_r, o = {}) => request(`${authPath.replace(/\/$/, '')}/me`, 'GET', o),
    createUser: (r, o = {}) => request(`${root}/users`, 'POST', o, { ...r, ...(o.email !== undefined ? { email: o.email } : {}) }),
    updateUser: (r, o = {}) => request(user(r.principalId), 'PATCH', o, { ...(o.email !== undefined ? { email: o.email } : {}) }),
    disableUser: (r, o = {}) => request(`${user(r.principalId)}/disable`, 'POST', o),
    enableUser: (r, o = {}) => request(`${user(r.principalId)}/enable`, 'POST', o),
    resetUserPassword: (r, o = {}) => request(`${user(r.principalId)}/reset-password`, 'POST', o, { password: r.password }),
    assignRole: (r, o = {}) => request(`${user(r.principalId)}/roles`, 'POST', o, { roleId: r.roleId }),
    attachPolicy: (r, o = {}) => request(`${user(r.principalId)}/policies`, 'POST', o, { policyId: r.policyId }),
    deleteUser: (r, o = {}) => request(user(r.principalId), 'DELETE', o),
  };
}
export function createHttpMembersApi({ transport, workspaceId }: { transport: RolesHttpTransport; workspaceId: string }, { basePath = '/workspaces' }: { basePath?: string } = {}): import('../ports.js').MembersApiPort {
  const root = `${basePath.replace(/\/$/, '')}/${encodeURIComponent(workspaceId)}/members`;
  const request = async <T>(path: string, method: 'GET' | 'POST', o: RolesCallOptions, body?: Record<string, unknown>) => {
    o.signal?.throwIfAborted();
    return transport.request<T>({ path, method, ...(body ? { body } : {}) }, o.signal ? { signal: o.signal } : {});
  };
  return {
    listMembers: (_r, o = {}) => { const query = new URLSearchParams(); if (o.afterId !== undefined) query.set('afterId', o.afterId); if (o.limit !== undefined) query.set('limit', String(o.limit)); return request(`${root}${query.size ? `?${query}` : ''}`, 'GET', o); },
    getMember: (r, o = {}) => request(`${root}/${encodeURIComponent(r.id)}`, 'GET', o),
    disableMember: (r, o = {}) => request(`${root}/${encodeURIComponent(r.id)}/disable`, 'POST', o),
    requestMemberMagicLink: (r, o = {}) => request(`${root}/request-magic-link`, 'POST', o, { email: r.email, ...(o.redirectPath !== undefined ? { redirectPath: o.redirectPath } : {}) }),
  };
}
export function createHttpAuthApi({ transport }: { transport: RolesHttpTransport }, { authPath = '/auth' }: { authPath?: string } = {}): import('../ports.js').AuthApiPort {
  return { login: async (r, o = {}) => {
    o.signal?.throwIfAborted();
    return transport.request({ path: `${authPath.replace(/\/$/, '')}/login`, method: 'POST', body: { username: r.username, password: r.password } }, o.signal ? { signal: o.signal } : {});
  } };
}
