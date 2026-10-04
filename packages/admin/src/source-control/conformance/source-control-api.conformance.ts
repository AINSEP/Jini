import type { SourceControlApiPort } from '../ports.js';
/** Creates/deletes named test credentials: run only on a disposable authorized backend.
 * Supply connectionFields for providers with required fields beyond the canonical token. */
export async function runSourceControlApiConformance({ api, providerId }: { api: SourceControlApiPort; providerId: string }, { connectionFields = {} }: { connectionFields?: Readonly<Record<string, string>> } = {}): Promise<readonly string[]> {
  const checks: string[] = [], ids: string[] = []; const assert = (ok: boolean, name: string) => { if (!ok) throw new Error(`Source control conformance: ${name}`); checks.push(name); };
  async function rejects(run: () => Promise<unknown>, name: string) { let rejected = false; try { await run(); } catch { rejected = true; } assert(rejected, name); }
  const connection = { ...connectionFields, providerId, token: 'conformance-only-token' };
  try {
    assert((await api.providers({})).some(p => p.id === providerId), 'provider is listed');
    const first = await api.create({ label: 'conformance-first', connection }); ids.push(first.id); assert(first.configured && !!first.id, 'create returns configured summary');
    assert(!('token' in first) && !('connection' in first), 'saved secrets never read back');
    assert((await api.list({})).some(r => r.id === first.id), 'list contains created row');
    await rejects(() => api.create({ label: 'conformance-first', connection }), 'duplicate label rejects');
    const second = await api.create({ label: 'conformance-second', connection, isDefault: true }); ids.push(second.id);
    const list = await api.list({}); assert(list.filter(r => r.providerId === providerId && r.isDefault).length === 1 && list.find(r => r.id === second.id)?.isDefault === true, 'server owns unique default slot');
    const renamed = await api.update({ id: first.id, patch: { label: 'conformance-renamed' } }); assert(renamed.label === 'conformance-renamed' && renamed.configured, 'metadata-only update preserves configured credential');
    assert(first.label === 'conformance-first', 'prior snapshots remain immutable');
    const replaced = await api.update({ id: first.id, patch: { connection } }); assert(replaced.id === first.id && replaced.label === renamed.label, 'replacement retains identity and label');
    await rejects(() => api.update({ id: first.id, patch: { connection: { providerId, token: '' } } }), 'blank replacement rejects');
    const abort = new AbortController(); abort.abort(); await rejects(() => api.list({}, { signal: abort.signal }), 'aborted list rejects');
    await rejects(() => api.update({ id: first.id, patch: { label: 'bad' } }, { signal: abort.signal }), 'aborted write rejects'); assert((await api.list({})).find(r => r.id === first.id)?.label === renamed.label, 'aborted write has no effects');
    await api.remove({ id: first.id }); await api.remove({ id: first.id }); assert(!(await api.list({})).some(r => r.id === first.id), 'remove is idempotent');
    await rejects(() => api.update({ id: first.id, patch: {} }), 'missing update rejects'); return Object.freeze(checks);
  } finally { for (const id of ids) await api.remove({ id }); }
}
