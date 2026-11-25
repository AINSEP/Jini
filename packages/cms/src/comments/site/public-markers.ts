/** Theme-authored {"type":"comments"} placement through the shared HTML marker parser. */
import { markersOfType, substituteMarkers, withElementKeptIfAttributed } from '../../widgets/markers/index.js';
import type { CommentThreadScript, CommentsProviderRegistry } from "@jini-ai/core/contracts/site/comments-providers";
import type { DeclaredScript } from '@jini-ai/core/contracts/site/cookie-consent';

type MarkerOptions = { cursor?: string; scripts?: (required: { scripts: readonly DeclaredScript[] }) => void };

/** Only a provider's optional executable assets inherit its purpose; its stored comments do not. */
function contributeScripts(required: { providers: CommentsProviderRegistry; providerId: string | null; scripts?: readonly CommentThreadScript[] }, optional: MarkerOptions): void {
  if (!required.providerId || !required.scripts?.length || !optional.scripts) return;
  const category = required.providers.get({ providerId: required.providerId })?.consentCategory;
  if (category) optional.scripts({ scripts: required.scripts.map(({ src }) => ({ src, consent: [category] })) });
}

/** Resolves once per entry/request. No cache is retained across moderation, selection or disable.
 * Marker-free pages do not read comments. Static consumers capture this HTML at export time.
 * @complexity O(h + p), h HTML bytes and p <= 200 rendered comments. */
export async function renderCommentsMarkers(required: {
  html: string; siteId: string; providers?: CommentsProviderRegistry;
  entry: { id: string; slug: string; title: string; canonicalUrl: string; status: string };
}, optional: MarkerOptions = {}): Promise<string> {
  if (markersOfType({ html: required.html, type: 'comments' }).length === 0) return required.html;
  let html = '';
  if (required.providers && required.entry.status === 'published') {
    const active = await required.providers.active({ siteId: required.siteId });
    if (active.adapter) {
      const rendered = await active.adapter.renderer.renderThread({ siteId: required.siteId, entry: required.entry, locale: 'en' },
        optional.cursor === undefined ? {} : { cursor: optional.cursor });
      html = rendered.html;
      contributeScripts({ providers: required.providers, providerId: active.providerId, ...(rendered.scripts && { scripts: rendered.scripts }) }, optional);
    }
  }
  return substituteMarkers({ html: required.html, resolve: marker => marker.type === 'comments'
    ? withElementKeptIfAttributed({ marker, inner: `<div data-comments-surface>${html}</div>` }) : undefined });
}
