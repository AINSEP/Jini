import { PostNotFoundError } from '../../../../../posts/post.js';
import { ListingBatchNotFoundError } from '../../../../../listing/request-state.js';

export async function postNotFoundPage({ redirect, theme, currentPath, staticMenus, finishStaticTierDocument, recordNotFound }: {
  redirect: () => Promise<boolean>;
  theme: { manifest: { tier: string }; pages: Readonly<Record<string, string>> } | null;
  currentPath: string; staticMenus: unknown;
  finishStaticTierDocument: (required: { pageId: string; html: string; currentPath: string; staticMenus: unknown }) => Promise<string | undefined>;
  recordNotFound: () => void;
}, _optional = {}): Promise<{ kind: 'handled' } | { kind: 'page'; status: 404; html: string }> {
  if (await redirect()) return { kind: 'handled' };
  // A static theme that ships its own pages/404.html gets a themed not-found page instead of
  // the bare fallback below — E4 (D2, 2026-09-23) runs it through the SAME
  // `finishStaticTierDocument` pipeline every other static-tier surface uses, so a widget or
  // collection marker on the 404 page (or a partial it references) resolves too, not only its menu
  // markers (the one thing the old direct `renderStaticPage` call already substituted).
  if (theme && theme.manifest.tier === 'static' && theme.pages['404'] !== undefined) {
    const staticHtml = await finishStaticTierDocument({ pageId: '404', html: theme.pages['404'], currentPath, staticMenus });
    if (staticHtml) {
      void recordNotFound();
      return { kind: 'page', status: 404, html: staticHtml };
    }
  }
  void recordNotFound();
  return { kind: 'page', status: 404, html: "<h1>404 — page not found</h1><p><a href='/'>Home</a></p>" };
}

/** `GET /:slug`'s catch: a see-more miss falls through to the 404, a missing post renders the
 *  themed 404, and anything else is a reported 500. */
export function classifySlugFailure({ err }: { err: unknown }, _optional = {}): 'listing' | 'missing' | 'fault' {
  if (err instanceof ListingBatchNotFoundError) return 'listing';
  // A `PostNotFoundError` is ordinary control flow on this route (no post at this slug), not a
  // fault — reporting it would bury every real fault under one line per 404 a crawler produces.
  if (err instanceof PostNotFoundError) return 'missing';
  return 'fault';
}
