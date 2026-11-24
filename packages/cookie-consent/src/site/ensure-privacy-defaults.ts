import { deriveAvailableName } from '@jini-ai/core/naming';
import { privacyPageTemplate } from './privacy-page-template.js';

/** The stored post fields this bootstrap reads to find or reserve the privacy Page. */
export interface PrivacyPageRow { slug: string; kind: string; title: string; status: string; deletedAt?: unknown }

/** The host's new-Page input: one published Page owned by the seeded owner. */
export interface PrivacyPageCreateInput { workspaceId: string; id: string; slug: string; title: string; kind: 'page'; status: 'published'; actorId: string }

/** Site-specific CMS bootstrap ports; persistence and identity remain with their existing owners. */
export interface PrivacyDefaultsDeps {
  workspaceId: string;
  post: { repo: { list(required: { workspaceId: string }): Promise<PrivacyPageRow[]>; transaction(required: { fn: () => Promise<void> }): Promise<unknown> } };
  /** The host's post-creation use case, bound to its own post repository, clock, outbox and author owners. */
  createPost(required: { input: PrivacyPageCreateInput }, optional?: Record<string, never>): Promise<unknown>;
  ids: { newId(): string };
  pagesHtmlStore(scope: { workspaceId: string; postId: string }): { ensureHtmlFormat(required: { seedHtml: string }, optional?: Record<string, never>): Promise<void> };
  readUrl(): Promise<string>;
  setUrl(input: { url: string; principalId: string }): Promise<void>;
  readIdentity(): Promise<{ siteTitle: string; email?: string; principalId: string }>;
}

/** Trash reserves slugs too: createPost otherwise moves its holder aside. O(n) stored rows. */
async function availableSlug({ rows }: { rows: PrivacyPageRow[] }): Promise<string> {
  const taken = new Set(rows.map(row => row.slug));
  if (!taken.has('privacy')) return 'privacy';
  return deriveAvailableName({ base: 'privacy-policy', isTaken: async ({ candidate }) => taken.has(candidate),
    withSuffix: ({ base, suffix }) => `${base}-${suffix}`,
    exhaustionMessage: () => 'No available Privacy Policy slug.' });
}

/** Ensure initial CMS policy content, preserving all owner choices and existing Page states.
 * @param deps Workspace-scoped content, identity, and legacy settings ports.
 * @returns Resolves when an empty legacy link has been filled; failures propagate for next-open retry.
 * @complexity O(n) time/space for one workspace's stored rows; one create/seed transaction at most. */
export async function ensureSitePrivacyDefaults(deps: PrivacyDefaultsDeps, _options = {}): Promise<void> {
  // The consent URL is the identity marker; an owner-set URL is never repaired or replaced.
  if ((await deps.readUrl()).trim()) return;
  const rows = await deps.post.repo.list({ workspaceId: deps.workspaceId });
  const candidates = rows.filter(row => row.kind === 'page' &&
    (row.slug === 'privacy' || row.slug === 'privacy-policy' || row.title === 'Privacy Policy'));
  const live = candidates.filter(row => !row.deletedAt);
  const existing = live.find(row => row.status === 'published') ?? live[0] ?? candidates[0];
  const identity = await deps.readIdentity();
  let slug = existing?.slug;
  if (!existing) {
    const created = await availableSlug({ rows });
    slug = created;
    const id = deps.ids.newId();
    // Only new Pages enter ensureHtmlFormat; converting an existing Page would replace owner content.
    await deps.post.repo.transaction({ fn: async () => {
      await deps.createPost({ input: { workspaceId: deps.workspaceId, id, slug: created,
        title: 'Privacy Policy', kind: 'page', status: 'published', actorId: identity.principalId } });
      await deps.pagesHtmlStore({ workspaceId: deps.workspaceId, postId: id }).ensureHtmlFormat({ seedHtml: privacyPageTemplate(identity) });
    } });
    // Boot runs before createApp subscribes; the serving drainer delivers the go-live event.
  }
  // Re-read immediately before Jini's write chokepoint so a newly saved owner URL wins.
  if ((await deps.readUrl()).trim()) return;
  await deps.setUrl({ url: `/${slug}`, principalId: identity.principalId });
}
