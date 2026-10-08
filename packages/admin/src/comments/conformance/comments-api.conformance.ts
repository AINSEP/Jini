import type { AdminCommentsPort, CommentStatus } from '../../core/ports/comments.js';

/** Destructive checklist for an isolated fixture containing at least two pending comments.
 * Uses only the core port, works against HTTP and memory, and throws at the first failed check.
 * @returns Named passed checks. The first seeded comment is purged; never use production data.
 */
export async function runCommentsApiConformance(
  { api }: { api: AdminCommentsPort },
  _optional: Record<string, never> = {},
): Promise<readonly string[]> {
  const checks: string[] = [];
  function assert(condition: boolean, name: string) {
    if (!condition) throw new Error(`Comments API conformance: ${name}`);
    checks.push(name);
  }
  async function rejects(run: () => Promise<unknown>, name: string) {
    let rejected = false;
    try { await run(); } catch { rejected = true; }
    assert(rejected, name);
  }
  const first = await api.listCommentsQueue({}, { status: 'pending', limit: 1 });
  const comment = first.items[0];
  if (!comment || !first.nextCursor) throw new Error('Conformance needs at least two pending comments');
  assert(first.items.length === 1 && comment.status === 'pending', 'status and limit filter');
  const second = await api.listCommentsQueue({}, { status: 'pending', limit: 1, cursor: first.nextCursor });
  assert(second.items.length === 1 && second.items[0]?.id !== comment.id, 'cursor advances without repeating rows');
  const settings = await api.getCommentsSettings({});
  const updated = await api.putCommentsSettings({}, { maxDepth: settings.maxDepth + 1, closeAfterDays: null });
  assert(updated.maxDepth === settings.maxDepth + 1 && updated.closeAfterDays === null && updated.enabled === settings.enabled, 'partial settings patch preserves siblings and null');
  assert((await api.getCommentsSettings({})).maxDepth === updated.maxDepth, 'settings read your writes');
  await rejects(() => api.putCommentsSettings({}, { spamAutoRejectScore: 2 }), 'invalid settings patch rejects');
  assert((await api.getCommentsSettings({})).spamAutoRejectScore === settings.spamAutoRejectScore, 'invalid settings patch is atomic');
  let current = comment;
  for (const [action, status] of [['approve', 'approved'], ['spam', 'spam'], ['trash', 'trash'], ['restore', 'approved']] as const) {
    const reply = await api.moderateComment({ commentId: current.id, action, expectedVersion: current.version });
    assert(reply === undefined, `${action} has no response body`);
    const page = await api.listCommentsQueue({}, { status: status as CommentStatus });
    const row = page.items.find(item => item.id === current.id);
    assert(row?.status === status && row.version === current.version + 1, `${action} changes status and increments version`);
    current = row!;
  }
  assert(comment.version === first.items[0]?.version && comment.status === 'pending', 'earlier queue snapshot is unchanged');
  try {
    await api.moderateComment({ commentId: current.id, action: 'trash', expectedVersion: comment.version });
    throw new Error('Stale moderation unexpectedly succeeded');
  } catch (e) {
    assert(e instanceof Error && 'status' in e && e.status === 409 && 'body' in e
      && (e.body as Record<string, unknown>)?.currentVersion === current.version, 'stale version rejects with status and currentVersion');
  }
  const remaining = await api.listCommentsQueue({}, { status: 'pending', limit: 1, cursor: first.nextCursor });
  assert(remaining.items[0]?.id === second.items[0]?.id, 'cursor survives its marker leaving the status');
  await api.moderateComment({ commentId: current.id, action: 'trash', expectedVersion: current.version });
  assert(await api.purgeComment({ commentId: current.id }) === undefined, 'purge has no version guard or response body');
  assert(!(await api.listCommentsQueue({}, { status: 'trash' })).items.some(item => item.id === current.id), 'purge removes the row');
  await rejects(() => api.purgeComment({ commentId: current.id }), 'missing purge rejects');
  await rejects(() => api.moderateComment({ commentId: current.id, action: 'approve', expectedVersion: current.version }), 'missing moderation rejects');
  await api.putCommentsSettings({}, settings);
  return Object.freeze(checks);
}
