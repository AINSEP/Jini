import type { useEffect as UseEffect, useState as UseState } from "react";

/**
 * @file Page Preview's template-rendered video links. The preview document is sandboxed in an opaque
 * origin (no `allow-same-origin`), so the admin frame can never read which videos the theme template
 * put on the page. Instead it asks the server's embed inspection route
 * (`.../posts/:id/template-preview/embeds`), which renders the SAME authorized draft the iframe shows
 * and answers only validated YouTube ids — never the HTML. The sandbox stays as it is.
 */

/** What one inspection request needs: the real post id, the preview URL's template tri-state and,
 *  for a hidden-form POST preview only, the exact `bodyHtml` the form submits (`null` for a GET). */
export interface PreviewEmbedIdsRequest {
  id: string;
  templateChoice: string | null;
  pendingHtml: string | null;
}

/** The authenticated port the host binds; `signal` aborts a superseded request. */
export type LoadPreviewEmbedIds = (
  required: PreviewEmbedIdsRequest,
  optional?: { signal?: AbortSignal },
) => Promise<{ youtubeIds: string[] }>;

/** Everything that changes the rendered preview, plus the port. */
export interface PreviewEmbedIdsArgs extends PreviewEmbedIdsRequest {
  useEffect: typeof UseEffect;
  useState: typeof UseState;
  /** Saved page version: an assistant save re-renders the GET preview. */
  version: number;
  /** `useThemePreviewFrame`'s `revision` — the same value that refreshes the iframe. */
  previewRevision: string | number;
  load: LoadPreviewEmbedIds;
}

/** The hook as `PagePreview` receives it: the host has already bound `load`. */
export type UsePreviewEmbedIds = (required: Omit<PreviewEmbedIdsArgs, "load" | "useEffect" | "useState">) => readonly string[];

/** Same trailing-only cadence as the hidden form's debounced auto-submit (`usePageEditor`). */
export const PREVIEW_EMBED_DEBOUNCE_MS = 500;

const NO_IDS: readonly string[] = Object.freeze([]);

/** The workspace-relative inspection path for a post, preserving the preview URL's `templateChoice`
 *  tri-state (`null` omits the key, `""` sends `?templateChoice=`, a filename sends that name) —
 *  `postsApi.templatePreviewUrl`'s own contract. @complexity O(id + template length). */
export function previewEmbedIdsPath(
  { workspaceId, id, templateChoice }: { workspaceId: string; id: string; templateChoice: string | null },
  _optional: Record<string, never> = {},
): string {
  const query = templateChoice === null ? "" : `?templateChoice=${encodeURIComponent(templateChoice)}`;
  return `/workspaces/${workspaceId}/posts/${encodeURIComponent(id)}/template-preview/embeds${query}`;
}

/** Binds the host's authenticated request adapter. A GET preview (`pendingHtml === null`) sends no
 *  pending body; a form preview sends the same `bodyHtml` the hidden form submits. */
export function createPreviewEmbedIdsLoader(
  { workspaceId, request, path }: {
    workspaceId: string;
    path: typeof previewEmbedIdsPath;
    request: <T>(required: { path: string; method: string; body?: unknown }, options?: { signal?: AbortSignal }) => Promise<T>;
  },
  _optional: Record<string, never> = {},
): LoadPreviewEmbedIds {
  return ({ id, templateChoice, pendingHtml }, { signal } = {}) => request<{ youtubeIds: string[] }>(
    { path: path({ workspaceId, id, templateChoice }), method: "POST", body: pendingHtml === null ? {} : { bodyHtml: pendingHtml } },
    signal ? { signal } : {},
  );
}

/** Only string ids survive a successful answer; anything else reads as "none found". */
function idsOf({ answer }: { answer: unknown }, _optional: Record<string, never> = {}): readonly string[] {
  const ids = (answer as { youtubeIds?: unknown } | null)?.youtubeIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : NO_IDS;
}

/**
 * Template-rendered YouTube ids for the current preview. Clears immediately whenever any input
 * changes (the previous template's ids must never stand in for the next one's), then asks once per
 * debounce window; a superseded request is aborted and, belt and braces, its answer is dropped by
 * request identity. A failure leaves the list empty, so the page-owned links remain the fallback.
 * @complexity O(1) per input change, plus one request.
 */
export function usePreviewEmbedIds(
  { id, templateChoice, version, previewRevision, pendingHtml, load, useEffect, useState }: PreviewEmbedIdsArgs,
  _optional: Record<string, never> = {},
): readonly string[] {
  // The answer carries the identity of the inputs it was asked for, so a render whose inputs have
  // already moved on (before the effect below even runs) can never show the previous answer.
  const identity = JSON.stringify([id, templateChoice, version, previewRevision, pendingHtml]);
  const [answer, setAnswer] = useState<{ identity: string; ids: readonly string[] } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const settle = (ids: readonly string[]) => { if (!controller.signal.aborted) setAnswer({ identity, ids }); };
    const timer = setTimeout(() => {
      load({ id, templateChoice, pendingHtml }, { signal: controller.signal }).then((result) => settle(idsOf({ answer: result })), () => settle(NO_IDS));
    }, PREVIEW_EMBED_DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [identity, id, templateChoice, pendingHtml, load]);
  return answer !== null && answer.identity === identity ? answer.ids : NO_IDS;
}
