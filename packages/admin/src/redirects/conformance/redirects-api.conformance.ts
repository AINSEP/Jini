import { AdminApiError } from '../../core/transport/errors.js';
import type { AdminRedirectsPort } from '../../core/ports/redirects.js';
/** Destructive framework-free checklist: use an isolated backend with no production data.
 * Validates core soft-delete, snapshots, lazy-read data and per-item partial import contracts.
 * Reference regex rejection probes can be disabled for a host implementing the port's open vocabulary.
 * @example await runRedirectsApiConformance({ api: createMemoryRedirectsApi({}, {}) }, {});
 */
export async function runRedirectsApiConformance(
  { api }: { api: AdminRedirectsPort },
  { referenceRegexRejection = true }: { referenceRegexRejection?: boolean } = {},
): Promise<readonly string[]> {
  const checks: string[] = [];
  function assert(ok: boolean, name: string): void {
    if (!ok) throw new AdminApiError({ message: `Redirects API conformance: ${name}`, status: 0 }, { code: 'CONFORMANCE_FAILED' });
    checks.push(name);
  }
  async function rejects(run: () => Promise<unknown>, name: string): Promise<void> {
    let rejected = false;
    try { await run(); } catch { rejected = true; }
    assert(rejected, name);
  }
  const input = { matchType: 'exact', fromPattern: '/redirects-conformance-a', toTarget: '/redirects-conformance-b', statusCode: 301 as const };
  const created = await api.createRedirect(input, { override: true, priority: 7 });
  assert(created.status === 'active' && created.override && created.priority === 7, 'create preserves fields and options');
  const before = await api.listRedirects({});
  assert(before.some(row => row.id === created.id), 'list contains the created rule');
  assert((await api.getRedirect({ id: created.id })).id === created.id, 'get reads by id');
  const hits = await api.getRedirectHitStats({ id: created.id });
  assert(hits.redirectId === created.id && hits.hitCount === 0 && hits.lastHitAt === null, 'new rule has zero hits');
  const updated = await api.updateRedirect({ id: created.id }, { status: 'disabled' });
  assert(updated.status === 'disabled' && updated.toTarget === created.toTarget, 'partial update preserves other fields');
  assert(created.status === 'active' && before.find(row => row.id === created.id)?.status === 'active', 'prior snapshots stay unchanged');
  assert((await api.listRedirects({}, { status: 'disabled' })).every(row => row.status === 'disabled'), 'status filter');
  await api.updateRedirect({ id: created.id }, { status: 'active' });
  const disabled = await api.tombstoneRedirect({ id: created.id });
  assert(disabled.status === 'disabled', 'tombstone returns the disabled rule');
  assert((await api.listRedirects({})).some(row => row.id === created.id), 'soft deletion retains the rule');
  assert((await api.getRedirect({ id: created.id })).status === 'disabled', 'tombstoned rule remains readable');
  await rejects(() => api.getRedirect({ id: 'missing-conformance-rule' }), 'missing rule rejects');
  await rejects(() => api.getRedirectHitStats({ id: 'missing-conformance-rule' }), 'missing hits differs from zero hits');
  await rejects(() => api.updateRedirect({ id: 'missing-conformance-rule' }, { status: 'disabled' }), 'missing update rejects');
  await rejects(() => api.tombstoneRedirect({ id: 'missing-conformance-rule' }), 'missing tombstone rejects');
  if (referenceRegexRejection) {
    await rejects(() => api.createRedirect({ ...input, fromPattern: '/regex-conformance', matchType: 'regex' }), 'reference regex create is loudly rejected');
    await rejects(() => api.updateRedirect({ id: created.id }, { matchType: 'regex' }), 'reference regex update is loudly rejected');
  }
  const batch = await api.importRedirects({ rules: [
    { ...input, fromPattern: '/import-conformance-a' },
    ...(referenceRegexRejection ? [{ ...input, fromPattern: '/import-conformance-regex', matchType: 'regex' }] : []),
    { ...input, fromPattern: '/import-conformance-c' },
  ] });
  if (referenceRegexRejection) {
    assert(batch.created.length === 2 && batch.failed.length === 1 && batch.failed[0]?.index === 1, 'middle failure preserves both successful siblings');
    assert(batch.created.every(row => row.fromPattern !== '/import-conformance-regex'), 'invalid item is never reported created');
  } else {
    assert(batch.created.length === 2 && batch.failed.length === 0, 'valid import batch succeeds');
  }
  assert(batch.created.every(row => row.source === 'import'), 'import provenance is stamped by the backend');
  for (const row of batch.created) await api.tombstoneRedirect({ id: row.id });
  return Object.freeze(checks);
}
