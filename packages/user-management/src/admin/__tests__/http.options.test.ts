import { describe, expect, it } from 'vitest';
import { createHttpAuthApi, createHttpMembersApi, createHttpRolesApi } from '../adapters/http.js';
import type { RolesHttpTransport } from '../ports.js';

type Call = [Parameters<RolesHttpTransport['request']>[0], Parameters<RolesHttpTransport['request']>[1]];
function recordingTransport() {
  const calls: Call[] = [];
  const transport: RolesHttpTransport = { async request<T>(r: Call[0], o?: Call[1]) { calls.push([r, o]); return {} as T; } };
  return { calls, transport };
}
function aborted() { const c = new AbortController(); c.abort(); return c.signal; }

describe('roles HTTP adapter optional fields', () => {
  it('omits absent optional body fields and sends a rename-only policy patch', async () => {
    const { calls, transport } = recordingTransport();
    const api = createHttpRolesApi({ transport, workspaceId: 'w' });
    await api.createPolicy({ name: 'p' });
    await api.updatePolicy({ policyId: 'p1' }, { name: 'renamed' });
    await api.writePolicyPermission({ policyId: 'p1', permission: 'content.read' });
    expect(calls.map(([r]) => r)).toEqual([
      { path: '/workspaces/w/policies', method: 'POST', body: { name: 'p' } },
      { path: '/workspaces/w/policies/p1', method: 'PATCH', body: { name: 'renamed' } },
      { path: '/workspaces/w/policies/p1/permissions', method: 'POST', body: { permission: 'content.read' } },
    ]);
  });
});

describe('members HTTP adapter', () => {
  it('lists without a query string by default and with paging parameters when given', async () => {
    const { calls, transport } = recordingTransport();
    const api = createHttpMembersApi({ transport, workspaceId: 'w' });
    await api.listMembers({});
    await api.listMembers({}, { afterId: 'm/1', limit: 25 });
    expect(calls.map(([r]) => r.path)).toEqual(['/workspaces/w/members', '/workspaces/w/members?afterId=m%2F1&limit=25']);
  });

  it('forwards the caller signal and refuses to send once it is aborted', async () => {
    const { calls, transport } = recordingTransport();
    const api = createHttpMembersApi({ transport, workspaceId: 'w' });
    const signal = new AbortController().signal;
    await api.getMember({ id: 'm/1' }, { signal });
    expect(calls).toEqual([[{ path: '/workspaces/w/members/m%2F1', method: 'GET' }, { signal }]]);
    await expect(api.disableMember({ id: 'm' }, { signal: aborted() })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('sends the magic-link redirect only when the caller supplies one', async () => {
    const { calls, transport } = recordingTransport();
    const api = createHttpMembersApi({ transport, workspaceId: 'w' });
    await api.requestMemberMagicLink({ email: 'a@example.test' });
    await api.requestMemberMagicLink({ email: 'a@example.test' }, { redirectPath: '/welcome' });
    expect(calls.map(([r]) => r.body)).toEqual([{ email: 'a@example.test' }, { email: 'a@example.test', redirectPath: '/welcome' }]);
  });
});

describe('auth HTTP adapter', () => {
  it('forwards the caller signal to the login request and refuses to send once aborted', async () => {
    const { calls, transport } = recordingTransport();
    const api = createHttpAuthApi({ transport }, { authPath: '/api/auth/' });
    const signal = new AbortController().signal;
    await api.login({ username: 'admin', password: 'pw' }, { signal });
    expect(calls).toEqual([[{ path: '/api/auth/login', method: 'POST', body: { username: 'admin', password: 'pw' } }, { signal }]]);
    await expect(api.login({ username: 'admin', password: 'pw' }, { signal: aborted() })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
