import { useEffect, useRef } from "react";

import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { navigate } from "../../../shell/lib/router.js";
import type { MediaTabId } from "./use-media-tabs.hooks.js";

/**
 * @file `/admin/media?id=<mediaId>` — a link to ONE media item (open-bugs 10-31). The item's
 * metadata dialog (`EditMediaModal`) is the media detail view, so the `?id=` value opens it: a
 * bookmark, a reload, or a link the assistant writes lands on that item instead of the whole grid.
 *
 * Two-way sync between the URL and `useMedia`'s own `editingId` state rather than moving that state
 * into the URL: the open/close/toggle logic (and its tests) stay where they are, and this hook only
 * (1) copies a URL id into the state whenever the URL changes and (2) writes the state back into the
 * URL whenever the owner opens or closes an item. `replace`, like `?tab=`: opening a few items
 * should not grow the back-button history one entry per click.
 */

export interface MediaItemLinkInput {
  /** The `?id=` query value (`null`/absent when the URL names no item). */
  itemId: string | null | undefined;
  activeTab: MediaTabId;
  /** `null` until the list loads — no "not found" verdict before then. */
  media: AdminMedia[] | null;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
}

/** `/media?tab=<tab>[&id=<id>]` — `tab` is always written, the same shape `useMediaTabs` writes. */
export function mediaItemPath({ activeTab, id }: { activeTab: MediaTabId; id: string | null }, _optional: Record<string, never> = {}): string {
  return id ? `/media?tab=${activeTab}&id=${encodeURIComponent(id)}` : `/media?tab=${activeTab}`;
}

/**
 * @returns `notFound` — the URL names an id the loaded library does not hold (deleted, purged, or
 * mistyped). The screen keeps the normal grid and shows a short notice; no dialog opens.
 * @complexity O(n) over `media` for the not-found check, once per render.
 */
export function useMediaItemLink(input: MediaItemLinkInput): { notFound: boolean } {
  const { itemId, activeTab, media, editingId, setEditingId } = input;
  const urlId = itemId || null;

  useEffect(() => {
    setEditingId(urlId);
  }, [urlId, setEditingId]);

  // Starts at the initial state so the first render (before the effect above has copied the URL id
  // in) is never mistaken for the owner closing the item, which would strip `?id=` from the URL.
  const lastEditingId = useRef(editingId);
  useEffect(() => {
    if (lastEditingId.current === editingId) return;
    lastEditingId.current = editingId;
    // Unconditional (an idempotent `replace`), not "only when it differs from `urlId`": a URL-driven
    // open writes back the same id, and comparing against a possibly stale prop could skip a close.
    navigate({ routePath: mediaItemPath({ activeTab, id: editingId }) }, { replace: true });
  }, [editingId, activeTab]);

  return { notFound: urlId !== null && media !== null && !media.some((item) => item.id === urlId) };
}
