import type { RolesApiPort } from '../ports.js';
/** Mutates a disposable, authenticated backend. Caller must hold role.manage and content.read.
 * Permission vocabulary can be supplied for another server's catalog. Cleanup failures are failures. */
export async function runRolesApiConformance({ api }: {
    api: RolesApiPort;
}, { permission = 'content.read', prefix = `conformance-${Date.now()}` }: {
    permission?: string;
    prefix?: string;
} = {}) {
    const passed: string[] = [], failed: {
        name: string;
        error: unknown;
    }[] = [];
    const assert = (value: unknown, message: string) => { if (!value)
        throw new Error(message); };
    async function check(name: string, run: () => Promise<void>) { try {
        await run();
        passed.push(name);
    }
    catch (error) {
        failed.push({ name, error });
    } }
    let roleId: string | undefined, policyId: string | undefined, otherPolicyId: string | undefined, rowId: string | undefined;
    try {
        await check('create custom role', async () => { const { role } = await api.createRole({ name: `${prefix}-role` }); roleId = role.id; assert(!role.isBuiltin, 'created role must be custom'); });
        await check('list roles', async () => assert((await api.listRoles({})).roles.some(r => r.id === roleId), 'created role absent'));
        await check('update role', async () => { assert(roleId, 'create role failed'); assert((await api.updateRole({ roleId: roleId!, name: `${prefix}-renamed` })).role.name === `${prefix}-renamed`, 'rename missing'); });
        await check('snapshot isolation', async () => { const first = await api.listRoles({}); const r = first.roles.find(r => r.id === roleId); assert(r, 'role missing'); r!.name = 'mutated'; assert((await api.listRoles({})).roles.find(r => r.id === roleId)?.name === `${prefix}-renamed`, 'mutable adapter storage exposed'); });
        await check('create custom policy', async () => { const { policy } = await api.createPolicy({ name: `${prefix}-policy` }, { description: 'before' }); policyId = policy.id; assert(!policy.isBuiltin && !policy.isFrozen, 'created policy must be mutable'); });
        await check('list policies', async () => assert((await api.listPolicies({})).policies.some(p => p.id === policyId), 'created policy absent'));
        await check('partial update preserves name and clears description', async () => { assert(policyId, 'policy missing'); const { policy } = await api.updatePolicy({ policyId: policyId! }, { description: '' }); assert(policy.name === `${prefix}-policy` && policy.description === '', 'partial update lost fields'); });
        await check('write scoped permission', async () => { assert(policyId, 'policy missing'); const { policyPermission: p } = await api.writePolicyPermission({ policyId: policyId!, permission }, { resourceType: 'article' }); rowId = p.id; assert(p.policyId === policyId && p.permission === permission && p.resourceType === 'article', 'wrong permission record'); });
        await check('list permission ids', async () => assert((await api.listPolicyPermissions({ policyId: policyId! })).policyPermissions.some(p => p.id === rowId), 'permission absent'));
        await check('cross-policy removal fails closed', async () => { const { policy } = await api.createPolicy({ name: `${prefix}-other` }); otherPolicyId = policy.id; let rejected = false; try {
            await api.removePolicyPermission({ policyId: policy.id, policyPermissionId: rowId! });
        }
        catch {
            rejected = true;
        } assert(rejected, 'removed foreign policy permission'); assert((await api.listPolicyPermissions({ policyId: policyId! })).policyPermissions.some(p => p.id === rowId), 'foreign row lost'); });
        await check('aborted writes do not persist', async () => { const abort = new AbortController(); abort.abort(); let rejected = false; try {
            await api.createRole({ name: `${prefix}-aborted` }, { signal: abort.signal });
        }
        catch {
            rejected = true;
        } assert(rejected, 'abort ignored'); assert(!(await api.listRoles({})).roles.some(r => r.name === `${prefix}-aborted`), 'aborted write persisted'); });
        await check('remove permission', async () => { await api.removePolicyPermission({ policyId: policyId!, policyPermissionId: rowId! }); assert((await api.listPolicyPermissions({ policyId: policyId! })).policyPermissions.length === 0, 'removal absent'); });
        await check('policy deletion cascades own permissions', async () => { await api.writePolicyPermission({ policyId: policyId!, permission }); await api.deletePolicy({ policyId: policyId! }); assert(!(await api.listPolicies({})).policies.some(p => p.id === policyId), 'policy deletion absent'); policyId = undefined; });
    }
    finally {
        if (roleId)
            await check('cleanup role', async () => { await api.deleteRole({ roleId: roleId! }); assert(!(await api.listRoles({})).roles.some(r => r.id === roleId), 'role deletion absent'); });
        if (policyId)
            await check('cleanup policy', async () => { await api.deletePolicy({ policyId: policyId! }); });
        if (otherPolicyId)
            await check('cleanup other policy', async () => { await api.deletePolicy({ policyId: otherPolicyId! }); });
    }
    return { passed, failed };
}

import type { UsersApiPort, MembersApiPort, AuthApiPort } from '../ports.js';
/** Isolated disposable host required. User deletion moves to Trash; its retention cleanup belongs
 * to the host. Members are disable-only, so conformance takes a dedicated fixture id. */
export async function runUsersApiConformance({ api }: { api: UsersApiPort }, { prefix = `users-${Date.now()}`, roleId, policyId }: { prefix?: string; roleId?: string; policyId?: string } = {}) {
  const passed: string[] = [], failed: { name: string; error: unknown }[] = [];
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const check = async (name: string, run: () => Promise<void>) => { try { await run(); passed.push(name); } catch (error) { failed.push({ name, error }); } };
  let principalId: string | undefined;
  try {
    await check('create operator', async () => { const { user } = await api.createUser({ username: prefix, password: 'test-secret' }, { email: 'before@example.test' }); principalId = user.principalId; assert(user.username === prefix.toLowerCase() && user.status === 'active', 'wrong created user'); });
    await check('list users roles policies and caller', async () => { const [u, r, p, me] = await Promise.all([api.listUsers({}), api.listRoles({}), api.listPolicies({}), api.me({})]); assert(u.users.some(u => u.principalId === principalId) && Array.isArray(r.roles) && Array.isArray(p.policies) && me.user.id, 'missing roster/caller'); });
    await check('snapshot isolation', async () => { const u = (await api.listUsers({})).users.find(u => u.principalId === principalId)!; (u.roleIds as string[]).push('foreign'); assert(!(await api.listUsers({})).users.find(u => u.principalId === principalId)!.roleIds.includes('foreign'), 'mutable role storage exposed'); });
    await check('email patch preserves omitted email', async () => { await api.updateUser({ principalId: principalId! }, { email: 'after@example.test' }); assert((await api.updateUser({ principalId: principalId! })).user.email === 'after@example.test', 'omitted email cleared'); });
    await check('disable and enable operator', async () => { assert((await api.disableUser({ principalId: principalId! })).user.status === 'disabled', 'disable missing'); assert((await api.enableUser({ principalId: principalId! })).user.status === 'active', 'enable missing'); });
    await check('reset password', async () => { await api.resetUserPassword({ principalId: principalId!, password: 'replacement' }); });
    if (roleId) await check('assign role', async () => { await api.assignRole({ principalId: principalId!, roleId }); assert((await api.listUsers({})).users.find(u => u.principalId === principalId)?.roleIds.includes(roleId), 'role missing'); });
    if (policyId) await check('attach policy', async () => { await api.attachPolicy({ principalId: principalId!, policyId }); assert((await api.listUsers({})).users.find(u => u.principalId === principalId)?.policyIds.includes(policyId), 'policy missing'); });
    await check('aborted write does not persist', async () => { const abort = new AbortController(); abort.abort(); let rejected = false; try { await api.updateUser({ principalId: principalId! }, { email: 'bad@example.test', signal: abort.signal }); } catch { rejected = true; } assert(rejected && (await api.listUsers({})).users.find(u => u.principalId === principalId)?.email === 'after@example.test', 'abort ignored'); });
  } finally {
    if (principalId) await check('delete moves out of roster', async () => { await api.deleteUser({ principalId: principalId! }); assert(!(await api.listUsers({})).users.some(u => u.principalId === principalId), 'trashed user still listed'); });
  }
  return { passed, failed };
}
export async function runMembersApiConformance({ api, memberId }: { api: MembersApiPort; memberId: string }, _optional: Record<string, never> = {}) {
  const passed: string[] = [], failed: { name: string; error: unknown }[] = [];
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const check = async (name: string, run: () => Promise<void>) => { try { await run(); passed.push(name); } catch (error) { failed.push({ name, error }); } };
  await check('list and read member', async () => { assert((await api.listMembers({})).members.some(m => m.id === memberId), 'member absent'); assert((await api.getMember({ id: memberId })).member.id === memberId, 'wrong member'); });
  await check('snapshot isolation', async () => { const { member } = await api.getMember({ id: memberId }); member.email = 'mutated@example.test'; assert((await api.getMember({ id: memberId })).member.email !== member.email, 'mutable storage exposed'); });
  await check('constant magic-link response', async () => { assert((await api.requestMemberMagicLink({ email: 'unregistered@example.test' })).delivered === true, 'enumeration response'); });
  await check('aborted disable does not persist', async () => { const before = (await api.getMember({ id: memberId })).member; const abort = new AbortController(); abort.abort(); let rejected = false; try { await api.disableMember({ id: memberId }, { signal: abort.signal }); } catch { rejected = true; } assert(rejected && (await api.getMember({ id: memberId })).member.status === before.status, 'abort ignored'); });
  await check('disable is idempotent', async () => { const first = (await api.disableMember({ id: memberId })).member, second = (await api.disableMember({ id: memberId })).member; assert(first.status === 'disabled' && second.status === 'disabled' && first.version === second.version, 'non-idempotent disable'); });
  return { passed, failed };
}
export async function runAuthApiConformance({ api, credentials, expectedUserId }: { api: AuthApiPort; credentials: { username: string; password: string }; expectedUserId: string }, _optional: Record<string, never> = {}) {
  const passed: string[] = [], failed: { name: string; error: unknown }[] = [];
  const check = async (name: string, run: () => Promise<void>) => { try { await run(); passed.push(name); } catch (error) { failed.push({ name, error }); } };
  await check('login returns expected account', async () => { if ((await api.login(credentials)).user.id !== expectedUserId) throw new Error('wrong account'); });
  await check('empty password is rejected', async () => { let rejected = false; try { await api.login({ ...credentials, password: '' }); } catch { rejected = true; } if (!rejected) throw new Error('empty password authenticated'); });
  await check('aborted login is rejected', async () => { const abort = new AbortController(); abort.abort(); let rejected = false; try { await api.login(credentials, { signal: abort.signal }); } catch { rejected = true; } if (!rejected) throw new Error('abort ignored'); });
  return { passed, failed };
}
