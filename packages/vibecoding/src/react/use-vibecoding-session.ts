/**
 * @module react/use-vibecoding-session
 *
 * The one hook every component in `./react` is built on: subscribes a component to a
 * `VibecodingSession` (`./session.js`) via `useSyncExternalStore` — React's own sanctioned way to
 * read a store that lives outside React, which `VibecodingSession` deliberately is (see that
 * module's doc for why: a tool handler invoked from the chat's execution path needs to reach the
 * same object a mounted component reads, and that object cannot be React state).
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { VibecodingSession, VibecodingSessionSnapshot } from './session.js';

export interface UseVibecodingSessionArgs {
  readonly session: VibecodingSession;
}

export interface UseVibecodingSessionResult extends VibecodingSessionSnapshot {
  readonly session: VibecodingSession;
  readonly refresh: () => Promise<void>;
  readonly readPart: VibecodingSession['readPart'];
  readonly applyEdits: VibecodingSession['applyEdits'];
  readonly undo: VibecodingSession['undo'];
  readonly redo: VibecodingSession['redo'];
}

/**
 * Subscribes to `session` and triggers its first `refresh()` on mount (and again if `session`
 * itself changes identity — a host swapping in a different artifact mid-session gets a fresh list
 * rather than a stale one left over from the previous session). Re-running `refresh()` a second
 * time for the same session instance is the caller's own choice via the returned `refresh`.
 *
 * A `refresh()` rejection is intentionally swallowed here rather than thrown from the effect —
 * `session.getSnapshot().lastError` already carries it (see `./session.js`), and an effect that
 * threw would only produce an uncatchable render-cycle error for a failure the snapshot already
 * reports. A caller that wants to react to it reads `lastError` or calls `refresh()` itself and
 * awaits/catches that promise directly.
 *
 * @param requiredArgs - the session port created by `createVibecodingSession`.
 * @returns the current snapshot plus the session's actions, bound to `session`.
 * @complexity O(1) beyond whatever `session`'s own methods cost — see `./session.js`.
 */
export function useVibecodingSession({ session }: UseVibecodingSessionArgs): UseVibecodingSessionResult {
  // React supplies a positional listener; keep its adapter stable across renders so reading
  // the session does not unsubscribe and resubscribe after each snapshot change.
  const subscribe = useCallback((listener: () => void) => session.subscribe({ listener }), [session]);
  const snapshot = useSyncExternalStore(subscribe, session.getSnapshot, session.getSnapshot);

  useEffect(() => {
    session.refresh().catch(() => {
      // Already recorded on the snapshot as `lastError` — see this function's doc.
    });
  }, [session]);

  const refresh = useCallback(() => session.refresh(), [session]);
  const readPart = useCallback<VibecodingSession['readPart']>((args) => session.readPart(args), [session]);
  const applyEdits = useCallback<VibecodingSession['applyEdits']>(
    (args, options) => session.applyEdits(args, options),
    [session],
  );
  const undo = useCallback(() => session.undo(), [session]);
  const redo = useCallback(() => session.redo(), [session]);

  return { ...snapshot, session, refresh, readPart, applyEdits, undo, redo };
}
