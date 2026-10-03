import { useRef } from "react";

export interface SettlementGeneration {
  // Mint synchronously before awaiting, then check after each await before touching shared state.
  // A successful write may instead mint only after it succeeds: minting before a failed write
  // would supersede an older read that was about to deliver the actual stored value.
  next: () => number;
  isCurrent: (required: { generation: number }) => boolean;
}

/** Stable monotonic generation handle for rejecting stale asynchronous settlements. */
export function useSettlementGeneration(): SettlementGeneration {
  const ref = useRef(0);
  // Same-tick calls must observe each other's increment. A state counter would let both read the
  // pre-commit value. This API models self-minted settlements, not field-edit versions or a counter
  // another operation only peeks at; those ambient guards need their own accurately scoped refs.
  // The returned object's IDENTITY must be stable across renders, not just the counter it closes
  // over: several adopting call sites (`use-access-tokens.hooks.ts`'s `reloadAllStores`, `use-sites
  // .hooks.ts`'s `activate`) are themselves wrapped in a `useCallback` that other code relies on
  // keeping a stable identity (e.g. `triggerReload`, so `useContentRefreshSubscription` doesn't
  // resubscribe on every render) — an object literal rebuilt every render would force either an
  // ESLint exhaustive-deps addition that defeats that memoization, or an intentional lint
  // suppression to omit it. Built once via a lazily-initialized ref, the same "stable handle over a
  // mutable ref" shape `useState`'s own setter uses.
  const apiRef = useRef<SettlementGeneration | undefined>(undefined);
  if (!apiRef.current) {
    apiRef.current = {
      next: () => (ref.current += 1),
      isCurrent: ({ generation }: { generation: number }) => ref.current === generation,
    };
  }
  return apiRef.current;
}
