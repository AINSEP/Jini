import type { AgentPluginsApiPort } from '../ports.js';
export interface AgentPluginsConformanceResult { readonly name: string; readonly passed: boolean }
/** Run in an isolated workspace fixture with two installed ids and readable files for pluginId. */
export async function runAgentPluginsApiConformance({ create, pluginId, otherPluginId }: { create: (required: Record<string, never>, optional?: Record<string, never>) => AgentPluginsApiPort | Promise<AgentPluginsApiPort>; pluginId: string; otherPluginId: string }, _optional = {}): Promise<readonly AgentPluginsConformanceResult[]> {
  const api = await create({}), results: AgentPluginsConformanceResult[] = [];
  const check = (condition: boolean) => { if (!condition) throw new Error('Contract violation'); };
  async function test(name: string, run: () => Promise<void> | void) { try { await run(); results.push({ name, passed: true }); } catch { results.push({ name, passed: false }); } }
  const initial = await api.list({}), first = initial.find(p => p.pluginId === pluginId), other = initial.find(p => p.pluginId === otherPluginId);
  if (!first || !other || pluginId === otherPluginId) throw new Error('Conformance needs two distinct installed plugin ids');
  const expectRejection = async (run: () => Promise<unknown>) => { let rejected = false; try { await run(); } catch { rejected = true; } check(rejected); };
  try {
    await test('lists installed packages independent of activation', () => { check(initial.length >= 2 && new Set(initial.map(p => p.pluginId)).size === initial.length); });
    await test('list snapshots are immutable', () => { check(Object.isFrozen(initial) && Object.isFrozen(first) && Object.isFrozen(first.skills) && Object.isFrozen(first.keywords) && Object.isFrozen(first.mcpServerIds)); });
    await test('activation replies with the single updated row', async () => { const row = await api.setEnabled({ pluginId, enabled: !first.enabled }); check(row.pluginId === pluginId && row.enabled === !first.enabled && row.description === first.description); });
    await test('accepted activation is visible on reload', async () => { check((await api.list({})).find(p => p.pluginId === pluginId)?.enabled === !first.enabled); });
    await test('old snapshot retains its original enabled value', () => { check(initial.find(p => p.pluginId === pluginId)?.enabled === first.enabled); });
    await test('unrelated row is unchanged', async () => { check(JSON.stringify((await api.list({})).find(p => p.pluginId === otherPluginId)) === JSON.stringify(other)); });
    await test('repeated assignment is idempotent', async () => { check((await api.setEnabled({ pluginId, enabled: !first.enabled })).enabled === !first.enabled); });
    await test('disabled package remains inspectable', async () => { await api.setEnabled({ pluginId, enabled: false }); const listing = await api.files({ pluginId }); check(listing.pluginId === pluginId && listing.files.length > 0); });
    await test('file metadata includes omission and bounds', async () => { const listing = await api.files({ pluginId }); check(typeof listing.truncated === 'boolean' && listing.limits.maxFiles > 0 && listing.files.every(f => typeof f.relativePath === 'string' && f.sizeBytes >= 0 && (f.content === null || typeof f.content === 'string'))); });
    await test('file snapshots are immutable', async () => { const listing = await api.files({ pluginId }); check(Object.isFrozen(listing) && Object.isFrozen(listing.files) && Object.isFrozen(listing.limits) && listing.files.every(f => Object.isFrozen(f))); });
    await test('missing activation rejects', async () => { await expectRejection(() => api.setEnabled({ pluginId: '__missing__', enabled: true })); });
    await test('missing inspector rejects', async () => { await expectRejection(() => api.files({ pluginId: '__missing__' })); });
    await test('nonboolean activation rejects without mutation', async () => { const before = (await api.list({})).find(p => p.pluginId === pluginId)?.enabled; await expectRejection(() => api.setEnabled({ pluginId, enabled: 'false' as unknown as boolean })); check((await api.list({})).find(p => p.pluginId === pluginId)?.enabled === before); });
    const abort = new AbortController(); abort.abort();
    await test('aborted list rejects', async () => { await expectRejection(() => api.list({}, { signal: abort.signal })); });
    await test('aborted files reject', async () => { await expectRejection(() => api.files({ pluginId }, { signal: abort.signal })); });
    await test('aborted write leaves activation intact', async () => { const before = (await api.list({})).find(p => p.pluginId === pluginId)?.enabled; await expectRejection(() => api.setEnabled({ pluginId, enabled: !before }, { signal: abort.signal })); check((await api.list({})).find(p => p.pluginId === pluginId)?.enabled === before); });
  } finally { await api.setEnabled({ pluginId, enabled: first.enabled }); }
  return Object.freeze(results.map(r => Object.freeze(r)));
}
