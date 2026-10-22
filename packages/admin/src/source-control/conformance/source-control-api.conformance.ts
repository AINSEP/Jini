import type { SourceControlApiPort } from '../ports.js';
import type { SourceControlConnection, SourceControlCredential } from '../models.js';

/** Shared state of one conformance run: `ids` collects created rows for cleanup, `checks` the passed check names. */
interface ConformanceRun { readonly api: SourceControlApiPort; readonly providerId: string; readonly connection: SourceControlConnection; readonly ids: string[]; readonly checks: string[] }

/** Records `name` as passed, or throws naming the provider and the failed check. */
function pass({ run, ok, name }: { run: ConformanceRun; ok: boolean; name: string }): void {
  if (!ok) throw new Error(`Source control conformance failed for provider "${run.providerId}": ${name}`);
  run.checks.push(name);
}

/** Passes `name` only when `attempt` rejects; the rejection reason itself is irrelevant to the contract. */
async function refuses({ run, attempt, name }: { run: ConformanceRun; attempt: () => Promise<unknown>; name: string }): Promise<void> {
  let rejected = false;
  try { await attempt(); } catch { rejected = true; }
  pass({ run, ok: rejected, name });
}

async function checkCreate({ run }: { run: ConformanceRun }): Promise<SourceControlCredential> {
  const { api, providerId, connection } = run;
  pass({ run, ok: (await api.providers({})).some(p => p.id === providerId), name: 'provider is listed' });
  const first = await api.create({ label: 'conformance-first', connection }); run.ids.push(first.id);
  pass({ run, ok: first.configured && !!first.id, name: 'create returns configured summary' });
  pass({ run, ok: !('token' in first) && !('connection' in first), name: 'saved secrets never read back' });
  pass({ run, ok: (await api.list({})).some(r => r.id === first.id), name: 'list contains created row' });
  await refuses({ run, attempt: () => api.create({ label: 'conformance-first', connection }), name: 'duplicate label rejects' });
  return first;
}

async function checkDefaultSlot({ run }: { run: ConformanceRun }): Promise<void> {
  const { api, providerId, connection } = run;
  const second = await api.create({ label: 'conformance-second', connection, isDefault: true }); run.ids.push(second.id);
  const list = await api.list({});
  pass({ run, ok: list.filter(r => r.providerId === providerId && r.isDefault).length === 1 && list.find(r => r.id === second.id)?.isDefault === true, name: 'server owns unique default slot' });
}

async function checkUpdates({ run, first }: { run: ConformanceRun; first: SourceControlCredential }): Promise<SourceControlCredential> {
  const { api, providerId, connection } = run;
  const renamed = await api.update({ id: first.id, patch: { label: 'conformance-renamed' } });
  pass({ run, ok: renamed.label === 'conformance-renamed' && renamed.configured, name: 'metadata-only update preserves configured credential' });
  pass({ run, ok: first.label === 'conformance-first', name: 'prior snapshots remain immutable' });
  const replaced = await api.update({ id: first.id, patch: { connection } });
  pass({ run, ok: replaced.id === first.id && replaced.label === renamed.label, name: 'replacement retains identity and label' });
  await refuses({ run, attempt: () => api.update({ id: first.id, patch: { connection: { providerId, token: '' } } }), name: 'blank replacement rejects' });
  return renamed;
}

async function checkAborts({ run, first, renamed }: { run: ConformanceRun; first: SourceControlCredential; renamed: SourceControlCredential }): Promise<void> {
  const { api } = run;
  const abort = new AbortController(); abort.abort();
  await refuses({ run, attempt: () => api.list({}, { signal: abort.signal }), name: 'aborted list rejects' });
  await refuses({ run, attempt: () => api.update({ id: first.id, patch: { label: 'bad' } }, { signal: abort.signal }), name: 'aborted write rejects' });
  pass({ run, ok: (await api.list({})).find(r => r.id === first.id)?.label === renamed.label, name: 'aborted write has no effects' });
}

async function checkRemove({ run, first }: { run: ConformanceRun; first: SourceControlCredential }): Promise<void> {
  const { api } = run;
  await api.remove({ id: first.id }); await api.remove({ id: first.id });
  pass({ run, ok: !(await api.list({})).some(r => r.id === first.id), name: 'remove is idempotent' });
  await refuses({ run, attempt: () => api.update({ id: first.id, patch: {} }), name: 'missing update rejects' });
}

/** Creates/deletes named test credentials: run only on a disposable authorized backend.
 * Supply connectionFields for providers with required fields beyond the canonical token. */
export async function runSourceControlApiConformance({ api, providerId }: { api: SourceControlApiPort; providerId: string }, { connectionFields = {} }: { connectionFields?: Readonly<Record<string, string>> } = {}): Promise<readonly string[]> {
  const run: ConformanceRun = { api, providerId, connection: { ...connectionFields, providerId, token: 'conformance-only-token' }, ids: [], checks: [] };
  try {
    const first = await checkCreate({ run });
    await checkDefaultSlot({ run });
    const renamed = await checkUpdates({ run, first });
    await checkAborts({ run, first, renamed });
    await checkRemove({ run, first });
    return Object.freeze(run.checks);
  } finally { for (const id of run.ids) await api.remove({ id }); }
}
