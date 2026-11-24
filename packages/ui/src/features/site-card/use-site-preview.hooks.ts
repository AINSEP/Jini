/**
 * @file Fetches one site's cached preview image on demand.
 *
 * The host's site record carries a `previewVersion` — a version token, never the image: a frequent
 * site-list poll cannot carry an image payload. This hook is the on-demand fetch that token exists to
 * trigger: it asks the injected bridge once per distinct version rather than once per poll.
 *
 * Refetches when `previewVersion` CHANGES, not when it "increases". The token is a filesystem
 * mtime (the host's preview store), and a restored backup or a clock-skewed capture can move it
 * backward as easily as forward — a growth check would silently keep serving a stale image in
 * exactly that case. React's dependency-array comparison (`Object.is`) already does the right thing
 * here for free; the only discipline this file owes is not "improving" it into a `>` comparison.
 *
 * `previewFetchPlan` and `nextPreviewUrl` are pulled out as plain functions so every decision the
 * effect makes is testable without a renderer. Between them they cover every decision the effect
 * makes; the ONE thing that stays inline is the `[id, previewVersion, getBridge]` dependency array
 * itself, because a dependency array is React's own wiring — there is no way to observe "did this
 * effect re-run" without a renderer to run it in.
 */
import { useEffect, useState } from "react";

/** The one bridge method this hook calls; channel names stay with the host. */
export interface SitePreviewBridge {
  getSitePreview: (required: { id: string }) => Promise<string | null>;
}

export type PreviewFetchPlan =
  | { readonly kind: "clear" }
  | { readonly kind: "skip" }
  | { readonly kind: "fetch"; readonly bridge: SitePreviewBridge; readonly id: string };

/**
 * What this effect run should do: clear the shown preview (no capture exists for this version, so
 * any URL held from a PRIOR id/version must not keep rendering under a card it no longer belongs
 * to), skip entirely (there IS a version to show, but no desktop bridge to ask), or fetch (the
 * bridge and id to ask it with). Checked in that order — a null version wins even when a bridge is
 * present, matching what the effect must do either way: show nothing.
 *
 * @complexity O(1).
 */
export function previewFetchPlan(
  { id, previewVersion, bridge }: { id: string; previewVersion: number | null; bridge: SitePreviewBridge | undefined },
  _options: Record<string, never> = {},
): PreviewFetchPlan {
  if (previewVersion === null) return { kind: "clear" };
  if (bridge === undefined) return { kind: "skip" };
  return { kind: "fetch", bridge, id };
}

/**
 * What `setUrl` should be called with once `getSitePreview` settles, or `undefined` for "call
 * nothing at all" — this effect run was cancelled (a newer `id`/`previewVersion` started a fresh
 * request) before its own came back, and a stale result must not clobber whatever the newer run is
 * about to show.
 *
 * `outcome` is the settlement itself: `{ ok: true, url }` for a resolved `getSitePreview` (`url` is
 * `null` when there is genuinely no capture yet, which renders identically to a fetch that has not
 * resolved or one that failed — see this file's own `useSitePreview` doc), `{ ok: false }` for a
 * rejected one.
 *
 * @complexity O(1).
 */
export function nextPreviewUrl(
  { cancelled, outcome }: { cancelled: boolean; outcome: { readonly ok: true; readonly url: string | null } | { readonly ok: false } },
  _options: Record<string, never> = {},
): string | null | undefined {
  if (cancelled) return undefined;
  return outcome.ok ? outcome.url : null;
}

/**
 * `null` until a capture exists, the fetch has not resolved yet, or the fetch failed — all three
 * render identically, as no image, which is exactly the card tile's existing fallback (the
 * placeholder). The caller does not need to tell those apart: whichever it is, there is nothing to show.
 *
 * `getBridge` is the host's preload bridge lookup. Keep it stable: it is an effect dependency, so a
 * new function each render would refetch each render.
 *
 * @complexity O(1) plus one IPC round trip per distinct `previewVersion`.
 */
export function useSitePreview(
  { id, previewVersion, getBridge }: { id: string; previewVersion: number | null; getBridge: () => SitePreviewBridge | undefined },
  _options: Record<string, never> = {},
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const plan = previewFetchPlan({ id, previewVersion, bridge: getBridge() });
    if (plan.kind === "clear") {
      setUrl(null);
      return undefined;
    }
    if (plan.kind === "skip") return undefined;

    let cancelled = false;
    plan.bridge
      .getSitePreview({ id: plan.id })
      .then((result) => {
        const next = nextPreviewUrl({ cancelled, outcome: { ok: true, url: result } });
        if (next !== undefined) setUrl(next);
      })
      .catch(() => {
        const next = nextPreviewUrl({ cancelled, outcome: { ok: false } });
        if (next !== undefined) setUrl(next);
      });
    return () => {
      cancelled = true;
    };
  }, [id, previewVersion, getBridge]);

  return url;
}
