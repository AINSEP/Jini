import type { AdminComment, AdminCommentsPort, AdminCommentsQueuePage } from '../../core/ports/comments.js';

/** Shared state of one run: the port under test plus the recorder every phase reports through. */
interface ConformanceRun {
  api: AdminCommentsPort;
  assert: (condition: boolean, name: string) => void;
}
type Settled = { threw: false } | { threw: true; error: unknown };

async function settle({ run }: { run: () => Promise<unknown> }, _optional: Record<string, never> = {}): Promise<Settled> {
  try {
    await run();
    return { threw: false };
  } catch (error) {
    return { threw: true, error };
  }
}
async function rejects({ check, run, name }: { check: ConformanceRun; run: () => Promise<unknown>; name: string }, _optional: Record<string, never> = {}) {
  check.assert((await settle({ run })).threw, name);
}
function hasConflictVersion({ settled, version }: { settled: Settled; version: number }, _optional: Record<string, never> = {}): boolean {
  if (!settled.threw) return false;
  const e = settled.error;
  return e instanceof Error && 'status' in e && e.status === 409 && 'body' in e
    && (e.body as Record<string, unknown>)?.currentVersion === version;
}

async function checkPaging({ check }: { check: ConformanceRun }, _optional: Record<string, never> = {}) {
  const { api, assert } = check;
  const first = await api.listCommentsQueue({}, { status: 'pending', limit: 1 });
  const comment = first.items[0];
  if (!comment || !first.nextCursor) throw new Error('Conformance needs at least two pending comments');
  assert(first.items.length === 1 && comment.status === 'pending', 'status and limit filter');
  const second = await api.listCommentsQueue({}, { status: 'pending', limit: 1, cursor: first.nextCursor });
  assert(second.items.length === 1 && second.items[0]?.id !== comment.id, 'cursor advances without repeating rows');
  return { first, comment, cursor: first.nextCursor, second };
}
async function checkSettings({ check }: { check: ConformanceRun }, _optional: Record<string, never> = {}) {
  const { api, assert } = check;
  const settings = await api.getCommentsSettings({});
  const updated = await api.putCommentsSettings({}, { maxDepth: settings.maxDepth + 1, closeAfterDays: null });
  assert(updated.maxDepth === settings.maxDepth + 1 && updated.closeAfterDays === null && updated.enabled === settings.enabled, 'partial settings patch preserves siblings and null');
  assert((await api.getCommentsSettings({})).maxDepth === updated.maxDepth, 'settings read your writes');
  await rejects({ check, run: () => api.putCommentsSettings({}, { spamAutoRejectScore: 2 }), name: 'invalid settings patch rejects' });
  assert((await api.getCommentsSettings({})).spamAutoRejectScore === settings.spamAutoRejectScore, 'invalid settings patch is atomic');
  return settings;
}
async function checkModerationCycle({ check, comment }: { check: ConformanceRun; comment: AdminComment }, _optional: Record<string, never> = {}) {
  const { api, assert } = check;
  let current = comment;
  for (const [action, status] of [['approve', 'approved'], ['spam', 'spam'], ['trash', 'trash'], ['restore', 'approved']] as const) {
    const reply = await api.moderateComment({ commentId: current.id, action, expectedVersion: current.version });
    assert(reply === undefined, `${action} has no response body`);
    const page = await api.listCommentsQueue({}, { status });
    const row = page.items.find(item => item.id === current.id);
    assert(row?.status === status && row.version === current.version + 1, `${action} changes status and increments version`);
    current = row!;
  }
  return current;
}
async function checkCursorAndPurge(
  { check, current, cursor, second }: { check: ConformanceRun; current: AdminComment; cursor: string; second: AdminCommentsQueuePage },
  _optional: Record<string, never> = {},
) {
  const { api, assert } = check;
  const remaining = await api.listCommentsQueue({}, { status: 'pending', limit: 1, cursor });
  assert(remaining.items[0]?.id === second.items[0]?.id, 'cursor survives its marker leaving the status');
  await api.moderateComment({ commentId: current.id, action: 'trash', expectedVersion: current.version });
  assert(await api.purgeComment({ commentId: current.id }) === undefined, 'purge has no version guard or response body');
  assert(!(await api.listCommentsQueue({}, { status: 'trash' })).items.some(item => item.id === current.id), 'purge removes the row');
  await rejects({ check, run: () => api.purgeComment({ commentId: current.id }), name: 'missing purge rejects' });
  await rejects({ check, run: () => api.moderateComment({ commentId: current.id, action: 'approve', expectedVersion: current.version }), name: 'missing moderation rejects' });
}

/** Destructive checklist for an isolated fixture containing at least two pending comments.
 * Uses only the core port, works against HTTP and memory, and throws at the first failed check.
 * @returns Named passed checks. The first seeded comment is purged; never use production data.
 */
export async function runCommentsApiConformance(
  { api }: { api: AdminCommentsPort },
  _optional: Record<string, never> = {},
): Promise<readonly string[]> {
  const checks: string[] = [];
  const check: ConformanceRun = { api, assert(condition, name) {
    if (!condition) throw new Error(`Comments API conformance: ${name}`);
    checks.push(name);
  } };
  const { first, comment, cursor, second } = await checkPaging({ check });
  const settings = await checkSettings({ check });
  const current = await checkModerationCycle({ check, comment });
  check.assert(comment.version === first.items[0]?.version && comment.status === 'pending', 'earlier queue snapshot is unchanged');
  const stale = await settle({ run: () => api.moderateComment({ commentId: current.id, action: 'trash', expectedVersion: comment.version }) });
  check.assert(hasConflictVersion({ settled: stale, version: current.version }), 'stale version rejects with status and currentVersion');
  await checkCursorAndPurge({ check, current, cursor, second });
  await api.putCommentsSettings({}, settings);
  return Object.freeze(checks);
}
