import { PostNotFoundError } from '../../../../../posts/post.js';
import { ListingBatchNotFoundError } from '../../../../../listing/request-state.js';

export async function postNotFoundPage<TTheme extends { manifest: { tier: string }; pages: Readonly<Record<string, string>> }, TMenus>({ redirect, theme, currentPath, staticMenus, finishStaticTierDocument, recordNotFound, fallbackHtml }: {
  redirect: () => Promise<boolean>;
  theme: TTheme | null;
  currentPath: string; staticMenus: TMenus;
  finishStaticTierDocument: (required: { theme: TTheme; pageId: string; html: string; currentPath: string; staticMenus: TMenus }) => Promise<string | undefined>;
  recordNotFound: () => void; fallbackHtml: string;
}, _optional = {}): Promise<{ kind: 'handled' } | { kind: 'page'; status: 404; html: string }> {
  if (await redirect()) return { kind: 'handled' };
  // A static theme that ships its own pages/404.html gets a themed not-found page instead of
  // the bare fallback below — E4 (D2, 2026-09-23) runs it through the SAME
  // `finishStaticTierDocument` pipeline every other static-tier surface uses, so a widget or
  // collection marker on the 404 page (or a partial it references) resolves too, not only its menu
  // markers (the one thing the old direct `renderStaticPage` call already substituted).
  if (theme && theme.manifest.tier === 'static' && theme.pages['404'] !== undefined) {
    const staticHtml = await finishStaticTierDocument({ theme, pageId: '404', html: theme.pages['404'], currentPath, staticMenus });
    if (staticHtml) {
      void recordNotFound();
      return { kind: 'page', status: 404, html: staticHtml };
    }
  }
  void recordNotFound();
  return { kind: 'page', status: 404, html: fallbackHtml };
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

export async function handlePostNotFoundOnSlugRoute<TTheme extends { manifest: { tier: string }; pages: Readonly<Record<string, string>> }, TMenus>(required: Parameters<typeof postNotFoundPage<TTheme, TMenus>>[0] & {
  send: (required: { status: 404; html: string }) => void;
}, _optional = {}): Promise<void> {
  const reply = await postNotFoundPage(required);
  if (reply.kind === 'page') required.send(reply);
}

export async function handleSlugRouteError(required: {
  err: unknown; listing: () => void; missing: () => Promise<void>; report: (err: unknown) => void; sendFault: () => void;
}, _optional = {}): Promise<void> {
  const classification = classifySlugFailure({ err: required.err });
  if (classification === 'listing') return required.listing();
  // A `PostNotFoundError` is ordinary control flow on this route (no post at this slug), not a
  // fault — reporting it would bury every real fault under one line per 404 a crawler produces.
  if (classification === 'missing') {
    try { await required.missing(); }
    catch (err) { required.report(err); required.sendFault(); }
    return undefined;
  }
  required.report(required.err);
  required.sendFault();
  return undefined;
}
