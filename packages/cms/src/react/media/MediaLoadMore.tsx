import { agentHandle } from "@jini-ai/core/agent-handles";

/**
 * @file The grid's "Load more" row: one button for the next server page, and in place of it a
 * plain-words failure with Retry when that page could not be read. Kept out of `Media.tsx` so the
 * screen file does not grow; it holds no state — `useMedia` owns the paging.
 */
export function MediaLoadMore({ hasMore, loading, error, onLoadMore, t }: {
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  onLoadMore: () => void;
  t: (key: string) => string;
}, _optional = {}) {
  if (!hasMore) return null;
  return (
    <div className="media-load-more">
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      <button
        type="button"
        className="button"
        disabled={loading}
        onClick={onLoadMore}
        {...agentHandle({ handle: "media-load-more" }, { role: "button", label: "Load the next page of media" })}
      >
        {error ? t("Try again") : t("Load more")}
      </button>
    </div>
  );
}
