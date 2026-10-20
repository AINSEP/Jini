import { AdminApiError } from '../../core/transport/errors.js';
import type { AdminRedirect, AdminRedirectCreateInput, AdminRedirectsPort } from '../../core/ports/redirects.js';

/** Records each passing check by name; the first failing check aborts the whole run. */
interface Checklist {
  readonly passed: string[];
  check(required: { ok: boolean; name: string }): void;
  rejects(required: { run: () => Promise<unknown>; name: string }): Promise<void>;
}

/** The id every not-found probe asks for; no conforming backend may hold it. */
const MISSING = { id: 'missing-conformance-rule' };

function createChecklist(_required: Record<string, never> = {}, _optional = {}): Checklist {
  const passed: string[] = [];
  function check({ ok, name }: { ok: boolean; name: string }): void {
    if (!ok) throw new AdminApiError({ message: `Redirects API conformance: ${name}`, status: 0 }, { code: 'CONFORMANCE_FAILED' });
    passed.push(name);
  }
  async function rejects({ run, name }: { run: () => Promise<unknown>; name: string }): Promise<void> {
    let rejected = false;
    try { await run(); } catch { rejected = true; }
    check({ ok: rejected, name });
  }
  return { passed, check, rejects };
}

async function checkCreateAndRead(
  { api, list, input }: { api: AdminRedirectsPort; list: Checklist; input: AdminRedirectCreateInput }, _optional = {},
): Promise<{ created: AdminRedirect; before: readonly AdminRedirect[] }> {
  const created = await api.createRedirect(input, { override: true, priority: 7 });
  list.check({ ok: created.status === 'active' && created.override && created.priority === 7, name: 'create preserves fields and options' });
  const before = await api.listRedirects({});
  list.check({ ok: before.some(row => row.id === created.id), name: 'list contains the created rule' });
  list.check({ ok: (await api.getRedirect({ id: created.id })).id === created.id, name: 'get reads by id' });
  const hits = await api.getRedirectHitStats({ id: created.id });
  list.check({ ok: hits.redirectId === created.id && hits.hitCount === 0 && hits.lastHitAt === null, name: 'new rule has zero hits' });
  return { created, before };
}

async function checkUpdate(
  { api, list, created, before }: { api: AdminRedirectsPort; list: Checklist; created: AdminRedirect; before: readonly AdminRedirect[] }, _optional = {},
): Promise<void> {
  const updated = await api.updateRedirect({ id: created.id }, { status: 'disabled' });
  list.check({ ok: updated.status === 'disabled' && updated.toTarget === created.toTarget, name: 'partial update preserves other fields' });
  list.check({ ok: created.status === 'active' && before.find(row => row.id === created.id)?.status === 'active', name: 'prior snapshots stay unchanged' });
  list.check({ ok: (await api.listRedirects({}, { status: 'disabled' })).every(row => row.status === 'disabled'), name: 'status filter' });
  await api.updateRedirect({ id: created.id }, { status: 'active' });
}

async function checkSoftDelete({ api, list, id }: { api: AdminRedirectsPort; list: Checklist; id: string }, _optional = {}): Promise<void> {
  const disabled = await api.tombstoneRedirect({ id });
  list.check({ ok: disabled.status === 'disabled', name: 'tombstone returns the disabled rule' });
  list.check({ ok: (await api.listRedirects({})).some(row => row.id === id), name: 'soft deletion retains the rule' });
  list.check({ ok: (await api.getRedirect({ id })).status === 'disabled', name: 'tombstoned rule remains readable' });
}

async function checkMissingRule({ api, list }: { api: AdminRedirectsPort; list: Checklist }, _optional = {}): Promise<void> {
  await list.rejects({ run: () => api.getRedirect(MISSING), name: 'missing rule rejects' });
  await list.rejects({ run: () => api.getRedirectHitStats(MISSING), name: 'missing hits differs from zero hits' });
  await list.rejects({ run: () => api.updateRedirect(MISSING, { status: 'disabled' }), name: 'missing update rejects' });
  await list.rejects({ run: () => api.tombstoneRedirect(MISSING), name: 'missing tombstone rejects' });
}

async function checkReferenceRegexRejection(
  { api, list, input, id }: { api: AdminRedirectsPort; list: Checklist; input: AdminRedirectCreateInput; id: string }, _optional = {},
): Promise<void> {
  await list.rejects({ run: () => api.createRedirect({ ...input, fromPattern: '/regex-conformance', matchType: 'regex' }), name: 'reference regex create is loudly rejected' });
  await list.rejects({ run: () => api.updateRedirect({ id }, { matchType: 'regex' }), name: 'reference regex update is loudly rejected' });
}

/** With reference rejection, a regex item sits between two valid ones to prove per-item partial success. */
async function checkImport(
  { api, list, input }: { api: AdminRedirectsPort; list: Checklist; input: AdminRedirectCreateInput },
  { referenceRegexRejection }: { referenceRegexRejection: boolean },
): Promise<void> {
  const batch = await api.importRedirects({ rules: [
    { ...input, fromPattern: '/import-conformance-a' },
    ...(referenceRegexRejection ? [{ ...input, fromPattern: '/import-conformance-regex', matchType: 'regex' }] : []),
    { ...input, fromPattern: '/import-conformance-c' },
  ] });
  if (referenceRegexRejection) {
    list.check({ ok: batch.created.length === 2 && batch.failed.length === 1 && batch.failed[0]?.index === 1, name: 'middle failure preserves both successful siblings' });
    list.check({ ok: batch.created.every(row => row.fromPattern !== '/import-conformance-regex'), name: 'invalid item is never reported created' });
  } else {
    list.check({ ok: batch.created.length === 2 && batch.failed.length === 0, name: 'valid import batch succeeds' });
  }
  list.check({ ok: batch.created.every(row => row.source === 'import'), name: 'import provenance is stamped by the backend' });
  for (const row of batch.created) await api.tombstoneRedirect({ id: row.id });
}

/** Destructive framework-free checklist: use an isolated backend with no production data.
 * Validates core soft-delete, snapshots, lazy-read data and per-item partial import contracts.
 * Reference regex rejection probes can be disabled for a host implementing the port's open vocabulary.
 * @example await runRedirectsApiConformance({ api: createMemoryRedirectsApi({}, {}) }, {});
 */
export async function runRedirectsApiConformance(
  { api }: { api: AdminRedirectsPort },
  { referenceRegexRejection = true }: { referenceRegexRejection?: boolean } = {},
): Promise<readonly string[]> {
  const list = createChecklist();
  const input = { matchType: 'exact', fromPattern: '/redirects-conformance-a', toTarget: '/redirects-conformance-b', statusCode: 301 as const };
  const { created, before } = await checkCreateAndRead({ api, list, input });
  await checkUpdate({ api, list, created, before });
  await checkSoftDelete({ api, list, id: created.id });
  await checkMissingRule({ api, list });
  if (referenceRegexRejection) await checkReferenceRegexRejection({ api, list, input, id: created.id });
  await checkImport({ api, list, input }, { referenceRegexRejection });
  return Object.freeze(list.passed);
}
