import { useEffect, useRef } from "react";
import type { FetchQueryAdapter, QueryKey } from "@jini-ai/core/fetch";

export function createAppearanceDraftStore(_required: Record<string, never>, _optional: Record<string, never> = {}): WeakMap<HTMLElement, Map<string, { accentColor: string | undefined; version: number }>> {
  return new WeakMap<HTMLElement, Map<string, { accentColor: string | undefined; version: number }>>();
}

/** Follow the appearance ledger, protecting each theme's drafts newer than the accepted read.
 * @complexity O(n) per accepted read/theme switch for n cached drafts; root state is weakly held. */
export function useAdminAppearance<Payload>({ store, root, port, useThemeStateHook, useAppearanceSnapshotHook, useInvalidateHook, paintAccent, resolveAccent, queryPrefix }: {
  store: ReturnType<typeof createAppearanceDraftStore>;
  root: HTMLElement;
  port: { loadAppearance(): Promise<Payload>; subscribeToSettingsRefresh(required: { listener: () => void }): () => void };
  useThemeStateHook: (required: Record<string, never>, optional: { root: HTMLElement }) => { themeId: string };
  useAppearanceSnapshotHook: (required: { port: { loadAppearance(): Promise<Payload> } }, optional: { root: HTMLElement }) => { data: { appearance: Payload; readPreviewVersion: number } | undefined };
  useInvalidateHook: FetchQueryAdapter["useInvalidate"];
  paintAccent: (required: { accentColor: string | undefined; root: HTMLElement }, optional: Record<string, never>) => void;
  resolveAccent: (required: { appearance: Payload; themeId: string }, optional: Record<string, never>) => string | undefined;
  queryPrefix: QueryKey;
}, _optional: Record<string, never> = {}) {
  const { themeId } = useThemeStateHook({}, { root });
  const paintedTheme = useRef(themeId);
  const query = useAppearanceSnapshotHook({ port }, { root });
  const invalidate = useInvalidateHook();
  useEffect(() => port.subscribeToSettingsRefresh({ listener: () => {
    invalidate({ key: queryPrefix });
  } }), [port, root, invalidate]);
  useEffect(() => {
    // An older response must not repaint a newer draft, including after a theme switch.
    // Other themes can still resolve their own saved choice; failed reads retain the last accent.
    const drafts = store.get(root);
    const themeChanged = paintedTheme.current !== themeId;
    paintedTheme.current = themeId;
    if (!query.data) {
      // A switch must never carry the previous theme's inline colour into an unloaded theme.
      if (themeChanged) paintAccent({ accentColor: drafts?.get(themeId)?.accentColor, root }, {});
      return;
    }
    // Only an accepted snapshot retires drafts, across all themes. A later preview in another
    // theme must never revive one that this read superseded; in-flight newer drafts survive.
    const readVersion = query.data.readPreviewVersion;
    drafts?.forEach((draft, id) => {
      if (draft.version <= readVersion) drafts.delete(id);
    });
    const draft = drafts?.get(themeId);
    const accentColor = draft && draft.version > readVersion
      ? draft.accentColor
      : resolveAccent({ appearance: query.data.appearance, themeId }, {});
    paintAccent({ accentColor, root }, {});
  }, [query.data, root, themeId]);
}

/** Preview the active theme's resolved draft before the debounced ledger save completes. */
export function useSettingsAppearance({ accentColor, ready, store, root, useThemeStateHook, advancePreview, paintAccent }: {
  accentColor: string | undefined; ready: boolean;
  store: ReturnType<typeof createAppearanceDraftStore>;
  root: HTMLElement;
  useThemeStateHook: (required: Record<string, never>, optional: { root: HTMLElement }) => { themeId: string };
  advancePreview: (required: { root: HTMLElement }, optional: Record<string, never>) => number;
  paintAccent: (required: { accentColor: string | undefined; root: HTMLElement }, optional: Record<string, never>) => void;
}, _optional: Record<string, never> = {}) {
  const { themeId } = useThemeStateHook({}, { root });
  useEffect(() => {
    if (ready) {
      const version = advancePreview({ root }, {});
      const drafts = store.get(root) ?? new Map();
      drafts.set(themeId, { accentColor, version });
      store.set(root, drafts);
      paintAccent({ accentColor, root }, {});
    }
  }, [accentColor, ready, root, themeId]);
}
