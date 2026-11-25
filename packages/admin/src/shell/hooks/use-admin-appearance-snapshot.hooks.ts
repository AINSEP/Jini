import { useCallback } from "react";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import { useAdminBootScope } from "../lib/admin-boot-scope.js";

// A controlled draft can change while the shell's initial read is still pending. Invalidate
// that read at the document boundary rather than letting it undo the operator's live preview.
const previewVersions = new WeakMap<HTMLElement, number>();

/** Advance this document's preview cutoff; weak ownership retains no unmounted document. */
export function advanceAppearancePreview({ root }: { root: HTMLElement }, _optional: object = {}): number {
  const version = (previewVersions.get(root) ?? 0) + 1;
  previewVersions.set(root, version);
  return version;
}

/** Everything `useAdminAppearanceSnapshot` reads from the host. */
export interface UseAdminAppearanceSnapshotArgs<T> {
  port: { loadAppearance(): Promise<T> };
  /** The settings namespace that owns the appearance values; part of the shared cache key. */
  namespace: string;
  useFetchQuery: FetchQueryAdapter["useFetchQuery"];
}

/**
 * Every observer of the shared appearance query uses this loader: the query cache may select any
 * observer's fetch on invalidation. Capture the cutoff before I/O, so a response retires only
 * drafts it started after. Errors remain query errors and never retire previews.
 * @example useAdminAppearanceSnapshot({ port, namespace, useFetchQuery }, { root })
 */
export function useAdminAppearanceSnapshot<T>(
  { port, namespace, useFetchQuery }: UseAdminAppearanceSnapshotArgs<T>,
  { root = document.documentElement } = {},
) {
  const { queryScope, checking } = useAdminBootScope();
  const fetchAppearance = useCallback(async () => {
    const readPreviewVersion = previewVersions.get(root) ?? 0;
    // Keep the read's cutoff in the cached value so structural sharing retains its freshness.
    // Metadata stays outside the stored config, which the theme picker passes back to save.
    return { appearance: await port.loadAppearance(), readPreviewVersion };
  }, [port, root]);
  return useFetchQuery<{ appearance: T; readPreviewVersion: number }>({ key: ["settings", namespace, queryScope], fetch: fetchAppearance }, { enabled: !checking, staleTime: Infinity });
}
