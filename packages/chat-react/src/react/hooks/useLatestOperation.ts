import { useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * "Only the newest attempt may write state" — the rule every async hook in this package needs, and
 * the one that produced the worst complexity in the feature.
 *
 * Written by hand it is a `if (!mountedRef.current || generation !== generationRef.current) return;`
 * after *every* await, repeated again inside the `catch`, inside a `useCallback` inside a hook — so
 * each of those guards is scored at nesting level 2 or 3 and costs 3 cognitive points rather than 1.
 * `useChatPaneWorkingDirectory` carried four near-identical copies of the shape.
 *
 * Here the guard throws instead of returning, and {@link LatestOperation.run} swallows it. The body
 * then reads as a straight line of awaits with `token.ensureCurrent()` between them, and the branch
 * exists once — in this file.
 */

/**
 * Thrown by {@link OperationToken.ensureCurrent} once its operation has been superseded or the
 * component has unmounted. Never escapes {@link LatestOperation.run}, and callers neither construct
 * nor catch it.
 */
class SupersededOperation extends Error {
  constructor() {
    super('operation superseded');
    this.name = 'SupersededOperation';
  }
}

export interface OperationToken {
  /**
   * Abandons the surrounding {@link LatestOperation.run} body unless this is still the newest
   * operation on a mounted component. Call it after each await, in place of a guard clause.
   */
  ensureCurrent(): void;
  /** Whether this is still the newest operation and the component is still mounted. */
  isCurrent(): boolean;
}

export interface LatestOperation {
  /**
   * Runs `body` as the newest operation, superseding any still in flight.
   *
   * `onError` is invoked only for a genuine failure of an operation that is *still* current — a
   * superseded or unmounted one is discarded silently, which is what the hand-written guards did.
   */
  run(
    body: (token: OperationToken) => Promise<void>,
    onError: (error: Error) => void,
  ): Promise<void>;
  /** Supersedes whatever is in flight without starting a new operation. */
  supersede(): void;
}

/** Preserves native Error objects while normalizing opaque host-bridge rejections. */
export function normalizeOperationError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Owns the mounted flag and the generation counter that decide which async attempt is allowed to
 * write state. One instance per hook: every operation started through it supersedes the previous
 * one, so a validation still in flight cannot clobber the result of the pick that replaced it.
 *
 * @complexity Time/space: O(1).
 */
export function useLatestOperation(): LatestOperation {
  const mountedRef = useRef(true);
  const generationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const supersede = useCallback(() => {
    generationRef.current += 1;
  }, []);

  const run = useCallback(async (
    body: (token: OperationToken) => Promise<void>,
    onError: (error: Error) => void,
  ): Promise<void> => {
    const generation = ++generationRef.current;
    const isCurrent = () => mountedRef.current && generation === generationRef.current;
    const token: OperationToken = {
      isCurrent,
      ensureCurrent: () => {
        // A generation only ever increases and unmount bumps it, so once stale always stale —
        // which is why `run`'s catch needs no `instanceof` test to tell this apart from a real
        // failure. `isCurrent()` is already false for anything thrown from here.
        if (!isCurrent()) throw new SupersededOperation();
      },
    };
    try {
      await body(token);
    } catch (error) {
      if (!isCurrent()) return;
      onError(normalizeOperationError(error));
    }
  }, []);

  return useMemo(() => ({ run, supersede }), [run, supersede]);
}
