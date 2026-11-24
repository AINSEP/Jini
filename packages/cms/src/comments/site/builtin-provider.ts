/** Tovu adapter for the CMS comments engine. The engine keeps storage, spam and audit ownership. */
import type { CommentsProviderAdapter, CommentsProviderDefinition, CommentThreadRendererPort } from '@jini-ai/core/contracts/site/comments-providers';
import type { CommentRepoPort, CommentIngressPolicy } from '../ports.js';
import type { CommentWriteService } from '../write-service.js';
import type { CommentsSettings, CommentRecord } from '../types.js';
import { ToolInputError } from '@jini-ai/core';
import { escapeHtml } from '@jini-ai/core/text';

export const BUILTIN_COMMENTS_DEFINITION: CommentsProviderDefinition = {
  id: 'built-in', label: 'Built-in', kind: 'stored', consentCategory: 'functional', implementation: 'adapter',
  csp: { scriptSrc: [], frameSrc: [], connectSrc: [], styleSrc: [] }, settingsSchema: [],
};
export interface BuiltinCommentsDeps {
  siteId: string;
  repo: CommentRepoPort;
  ingress: CommentIngressPolicy;
  writes: CommentWriteService;
  getSettings: (required: { siteId: string }, optional?: Record<string, never>) => Promise<CommentsSettings>;
  ready: Promise<void>;
}

/** Public fields only, escaped at the HTML sink. Depth is bounded even for legacy malformed rows. */
function commentHtml({ row, maxDepth }: { row: CommentRecord; maxDepth: number }, _options = {}) {
  const depth = Math.min(Math.max(0, row.depth), maxDepth);
  return `<li id="comment-${escapeHtml({ text: row.id })}" data-comment-depth="${depth}"><article><header>${escapeHtml({ text: row.authorName })}</header><p>${escapeHtml({ text: row.bodyText })}</p></article></li>`;
}

/** The 303 lands on `#comment-pending` / `#comment-error`; each notice shows only while it is the URL
 * fragment, so a plain page view never claims a submission happened. A stylesheet rule, not script. */
const NOTICE_STYLE = '<style>#comment-pending:not(:target),#comment-error:not(:target){display:none}</style>';

/** Native form: no scripts, no private values, existing website honeypot retained. */
function submissionForm({ entryId, path }: { entryId: string; path: string }, _options = {}) {
  return `${NOTICE_STYLE}<p id="comment-pending" role="status">Submitted comments are held for review when moderation is enabled.</p><p id="comment-error" role="alert">If your comment was not accepted, check the form and try again.</p>
<form method="post" action="/api/site/comments"><input type="hidden" name="entryId" value="${escapeHtml({ text: entryId })}"><input type="hidden" name="returnTo" value="${escapeHtml({ text: path })}">
<label>Name <input name="authorName" required maxlength="200" autocomplete="name"></label><label>Email (private, optional) <input name="authorEmail" type="email" maxlength="320" autocomplete="email"></label>
<label hidden>Leave empty <input name="website" tabindex="-1" autocomplete="off"></label><label>Comment <textarea name="body" required maxlength="10000"></textarea></label><button type="submit">Submit comment</button></form>`;
}

/** Bounds redirects and pagination to the entry's local URL. */
function entryPath({ canonicalUrl }: { canonicalUrl: string }, _options = {}) {
  const url = new URL(canonicalUrl, 'https://comments.invalid');
  return url.pathname.startsWith('//') ? '/' : url.pathname;
}

/** Puts each reply right after its parent (depth-first, in page order). A reply whose parent is on
 * an earlier page, and any row caught in a malformed parent cycle, still renders, after the threads.
 * @complexity O(p) for p rows on the page. */
function threadOrder({ rows }: { rows: readonly CommentRecord[] }, _options = {}): CommentRecord[] {
  const byId = new Map(rows.map(row => [row.id, row]));
  const children = new Map<string, CommentRecord[]>();
  for (const row of rows) if (row.parentId && byId.has(row.parentId)) children.set(row.parentId, [...children.get(row.parentId) ?? [], row]);
  const out: CommentRecord[] = []; const seen = new Set<string>();
  const visit = (row: CommentRecord) => {
    if (seen.has(row.id)) return;
    seen.add(row.id); out.push(row);
    for (const child of children.get(row.id) ?? []) visit(child);
  };
  for (const row of rows) if (!row.parentId || !byId.has(row.parentId)) visit(row);
  for (const row of rows) visit(row);
  return out;
}

/** A visitor-supplied cursor that no longer names a row (comment purged, or a hand-edited URL) is
 * the repo's `invalid cursor` refusal; on a public page that means "start at the first page", never a 500.
 * @complexity One bounded query, two when the cursor is refused. */
async function approvedPage({ repo, siteId, entryId, cursor }: { repo: CommentRepoPort; siteId: string; entryId: string; cursor?: string | undefined }, _options = {}) {
  const query = { workspaceId: siteId, entryId, status: 'approved' as const, limit: 200 };
  if (cursor === undefined) return repo.listModerationQueue(query);
  try {
    return await repo.listModerationQueue({ ...query, cursor });
  } catch (error) {
    if (!(error instanceof ToolInputError)) throw error;
    return repo.listModerationQueue(query);
  }
}

/** One entry-scoped database page (201 rows at most), with no thread recursion or page cache.
 * Every response re-reads selection/settings/approved rows, so moderation and disable are immediately visible.
 * @complexity O(p) rendering and one bounded query for p <= 200 comments. */
export function createBuiltinCommentsProvider(deps: BuiltinCommentsDeps, _options = {}): CommentsProviderAdapter & { kind: 'stored' } {
  const assertSite = ({ siteId }: { siteId: string }, _options = {}) => {
    if (siteId !== deps.siteId) throw new Error('Comments site mismatch');
  };
  const assertEnabled = async ({ siteId }: { siteId: string }, _options = {}) => {
    assertSite({ siteId });
    await deps.ready;
    if (!(await deps.getSettings({ siteId })).enabled) throw new ToolInputError({ message: 'Comments are disabled. Enable them in comments settings first.' });
  };
  const renderer: CommentThreadRendererPort = { async renderThread({ siteId, entry }, optional = {}) {
    assertSite({ siteId });
    await deps.ready;
    const settings = await deps.getSettings({ siteId });
    if (!settings.enabled) return { html: '' };
    const page = await approvedPage({ repo: deps.repo, siteId, entryId: entry.id, cursor: optional.cursor });
    const path = entryPath({ canonicalUrl: entry.canonicalUrl });
    const maxDepth = Math.min(20, Math.max(0, settings.maxDepth));
    const rows = page.items.filter(row => row.status === 'approved' && row.entryId === entry.id && row.workspaceId === siteId);
    const nextPath = page.nextCursor ? `${path}?commentCursor=${encodeURIComponent(page.nextCursor)}#comments` : '';
    const more = page.nextCursor ? `<a rel="next" href="${escapeHtml({ text: nextPath })}">More comments</a>` : '';
    const firstPath = `${path}#comments`;
    const first = optional.cursor === undefined ? '' : `<a href="${escapeHtml({ text: firstPath })}">First comments</a>`;
    return { html: `<section id="comments" aria-label="Comments"><h2>Comments</h2><ol>${threadOrder({ rows }).map(row => commentHtml({ row, maxDepth })).join('')}</ol>${first}${more}${submissionForm({ entryId: entry.id, path })}</section>` };
  } };
  return { kind: 'stored', renderer,
    submission: { async submit(input, _optional = {}) {
      assertSite(input);
      await deps.ready;
      const { siteId, authorIpHash, honeypotValue, ...fields } = input;
      const result = await deps.ingress.submit({ ...fields, workspaceId: siteId, authorPrincipalId: null, ingressContext: { authorIpHash, honeypotValue } });
      return result.ok ? { ok: true, id: result.comment.id, status: result.comment.status } : result;
    } },
    moderation: {
      async listQueue({ siteId, ...input }, _optional = {}) { assertSite({ siteId }); await deps.ready; return deps.repo.listModerationQueue({ ...input, workspaceId: siteId }); },
      async get({ siteId, id }, _optional = {}) { assertSite({ siteId }); await deps.ready; return deps.repo.findById({ workspaceId: siteId, id }); },
      async apply({ siteId, action, ...input }, _optional = {}) {
        await assertEnabled({ siteId });
        const statuses = { approve: 'approved', mark_spam: 'spam', trash: 'trash', restore: 'approved' } as const;
        return deps.writes.applyModeration({ ...input, action, workspaceId: siteId, toStatus: statuses[action] });
      },
      /** Not gated on `enabled`: erasing is allowed in exactly the state an owner cleans up in. */
      async purge({ siteId, ...input }, _optional = {}) { assertSite({ siteId }); await deps.ready; return deps.writes.purge({ ...input, workspaceId: siteId }); },
    },
  };
}
