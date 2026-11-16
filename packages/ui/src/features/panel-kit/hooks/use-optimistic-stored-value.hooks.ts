import { useCallback, useEffect, useRef, useState } from "react";

import type { QueryKey } from "@jini-ai/core/fetch";
import { useFetchQuery, useInvalidate } from "../fetch-query/index.js";

/** Where one stored value lives. `subscribe` reports changes made elsewhere (another tab's save). */
export interface StoredValuePort<T> {
  load(): Promise<T>;
  /** `previous` is what the caller believed was stored, so a host can undo or diff. */
  save(required: { next: T; previous: T }): Promise<void>;
  subscribe(required: { listener: () => void }): () => void;
}

export interface OptimisticStoredValueInput<T> {
  readonly queryKey: QueryKey;
  readonly port: StoredValuePort<T>;
  /** Shown until the first read arrives; a failed read keeps it. */
  readonly fallback: T;
  readonly same: (required: { a: T; b: T }) => boolean;
}

export interface OptimisticStoredValue<T> {
  readonly value: T;
  /** Applies `apply(previous)` at once and saves it; `previous` is the last value requested. */
  readonly update: (apply: (previous: T) => T) => void;
  /** The last save failed; the choice still applies until a re-read replaces it. */
  readonly saveFailed: boolean;
}

/**
 * A stored value that changes on the spot. A change shows through an optimistic copy and is saved;
 * the copy is dropped only once a re-read equals it, so a later change made elsewhere shows up
 * again. Two quick changes chain: the second save's `previous` is the first one's `next`, even before
 * the re-read or the next render.
 * @complexity O(1) per change.
 */
export function useOptimisticStoredValue<T>({ queryKey, port, fallback, same }: OptimisticStoredValueInput<T>, _optional: Record<string, never> = {}): OptimisticStoredValue<T> {
  const fetchStored = useCallback(() => port.load(), [port]);
  const query = useFetchQuery({ key: queryKey, fetch: fetchStored }, { staleTime: 0 });
  const invalidate = useInvalidate();
  const [optimistic, setOptimistic] = useState<{ value: T } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const lastRequested = useRef<{ value: T } | null>(null);
  const pendingSaves = useRef(0);
  const value = optimistic ? optimistic.value : (query.data ?? fallback);

  useEffect(() => port.subscribe({ listener: () => invalidate({ key: queryKey }) }), [port, invalidate, queryKey]);
  useEffect(() => {
    if (pendingSaves.current !== 0 || !optimistic || query.data === undefined) return;
    if (!same({ a: optimistic.value, b: query.data })) return;
    lastRequested.current = null;
    setOptimistic(null);
  }, [optimistic, query.data, same]);

  const update = useCallback((apply: (previous: T) => T) => {
    const previous = lastRequested.current ? lastRequested.current.value : value;
    const next = apply(previous);
    lastRequested.current = { value: next };
    pendingSaves.current += 1;
    setOptimistic({ value: next });
    port.save({ next, previous }).then(
      () => { pendingSaves.current -= 1; setSaveFailed(false); invalidate({ key: queryKey }); },
      () => { pendingSaves.current -= 1; setSaveFailed(true); },
    );
  }, [value, port, invalidate, queryKey]);

  return { value, update, saveFailed };
}
