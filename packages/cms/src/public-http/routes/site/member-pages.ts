import type { PublicPostRecord } from '../../../posts/post.js';

export type MemberPageReply = { kind: 'missing' } | { kind: 'redirect'; status: 303; location: string } | { kind: 'page'; post: PublicPostRecord };

/** The in-memory Page {@link serveVirtualPage} renders for one member path. @complexity O(1). */
export function makeMemberPagePost({ path, workspaceId, pages }: {
  path: string; workspaceId: string; pages: Readonly<Partial<Record<string, { id: string; title: string; body: string }>>>;
}, _optional = {}): PublicPostRecord | undefined {
  const entry = Object.hasOwn(pages, path) ? pages[path] : undefined;
  if (!entry) return undefined;
  return {
    id: entry.id, workspaceId, title: entry.title, slug: path.slice(1),
    bodyJson: {}, status: 'published', kind: 'page', bodyFormat: 'html', bodyHtml: entry.body,
    updatedAt: new Date(0).toISOString(), version: 1, templateChoice: null,
  };
}

export const memberPageRoute = {
  method: 'get' as const,
  async handle({ path, deps }: {
    path: string;
    deps: {
      workspaceId: string; pages: Readonly<Partial<Record<string, { id: string; title: string; body: string }>>>;
      accountPath: string; signInLocation: string;
      markPrivate(required: Record<string, never>): void;
      hasLiveSession(required: Record<string, never>): Promise<boolean>;
    };
  }, _optional = {}): Promise<MemberPageReply> {
    const normalized = path.replace(/\/$/, '');
    const post = makeMemberPagePost({ path: normalized, workspaceId: deps.workspaceId, pages: deps.pages });
    if (!post) return { kind: 'missing' };
    if (normalized === deps.accountPath) {
      // The response depends on a cookie: never share either the page or redirect through a cache.
      deps.markPrivate({});
      const session = await deps.hasLiveSession({});
      if (!session) {
        // Use sign-in's validated fragment contract; a fixed local path cannot inherit an attacker return URL.
        return { kind: 'redirect', status: 303, location: deps.signInLocation };
      }
    }
    return { kind: 'page', post };
  },
};
