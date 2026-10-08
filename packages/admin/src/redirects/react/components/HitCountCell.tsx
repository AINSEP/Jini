import { agentHandle } from '@jini-ai/agentic';
import { describeApiError } from '../../../core/transport/errors.js';
import type { RedirectsTranslate as Translate } from '../../models.js';
import { useWiredHitCountCell } from '../hooks/wired.hooks.js';
export interface HitCountCellProps {
  redirectId: string;
  /** Bound translator, threaded down from `Redirects`'s own hook rather than resolved here — see
   *  this file's header. */
  t: Translate;
  /** This row's own distinct handle base — same reasoning as `Users.tsx`'s `UserRowProps.agentBase`.
   *  Optional (identity-omitted default) since this component is exported and unit-tested directly
   *  without one. */
  agentHandleBase?: string;
  /** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
  useHitCountCellHook?: typeof useWiredHitCountCell;
}

/** Lazy hit-count cell (REQ-03) — fetches on first click rather than on mount, so a list of many
 *  rows never fires a synchronous burst of `/hits` requests. A rule with zero recorded hits still
 *  renders `0` (not blank), matching `hits.ts`'s own "still 200s with hitCount: 0" contract. */
export function HitCountCell({ redirectId, t, agentHandleBase, useHitCountCellHook = useWiredHitCountCell }: HitCountCellProps) {
  const { error, data, isFetching, request } = useHitCountCellHook({ redirectId, t });

  if (error) return <span className="save-error">{describeApiError({ e: error, fallback: "failed" })}</span>;
  // A rule with zero recorded hits still renders `0` (not blank), matching
  // `hits.ts`'s own "still 200s with hitCount: 0" contract — so this branches
  // on the request having completed, never on the count's truthiness.
  if (data) return <span>{data.data.hitCount}</span>;
  return (
    <button
      type="button"
      onClick={request}
      disabled={isFetching}
      {...(agentHandleBase ? agentHandle({ handle: `${agentHandleBase}-load-hits` }, { role: "button", label: "Load this rule's hit count" }) : {})}
    >
      {isFetching ? t("Loading…") : t("Load hits")}
    </button>
  );
}

