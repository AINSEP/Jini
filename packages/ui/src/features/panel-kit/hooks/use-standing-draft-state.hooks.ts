import { createConsoleLogger } from "@jini-ai/core/primitives";
import { useCallback, useRef, useState } from "react";
import type { StandingDraftAutosaveOptions, StandingDraftAutosaveInput, StandingDraftAutosaveSnapshot, StandingDraftStaleBasis } from "./use-standing-draft-autosave.hooks.js";
import { useSerialWrites as useSerialWritesDefault } from "./use-serial-writes.hooks.js";

export function useStandingDraftState(deps: StandingDraftAutosaveOptions, { useSerialWrites = useSerialWritesDefault }: { useSerialWrites?: typeof useSerialWritesDefault } = {}) {
  const { port } = deps;
  const [backupPrincipalId] = useState(() => port.getBackupPrincipalId?.({}, {}));
  const latestDraftRef = useRef<StandingDraftAutosaveInput | null>(null);
  const backupGenerationRef = useRef(0);
  const [recoverableDraft, setRecoverableDraft] = useState<StandingDraftAutosaveSnapshot | null>(null);
  const [staleBasis, setStaleBasis] = useState<StandingDraftStaleBasis | null>(null);
  // Mirrors `staleBasis` for the SYNCHRONOUS gate in `scheduleAutosave`: the refusal is discovered
  // inside the request chain, and a React state read there would be a render behind — the window in
  // which the very ticks this gate exists to stop would still be scheduled.
  const staleBasisRef = useRef<StandingDraftStaleBasis | null>(null);
  // Which entry's refused text is currently mirrored in browser storage, or `null`. Deliberately
  // NOT the same lifetime as the gate above (see this file's header), and deliberately an entry id
  // rather than a boolean: it is the proof that a mirror this hook may drop belongs to the entry
  // being edited right now, so switching entries can never delete another entry's surviving copy.
  const backupEntryIdRef = useRef<string | null>(null);
  // Every network op (each autosave PUT, and the eventual discard) is appended here, never fired
  // standalone — this IS the ordering guarantee `clearStandingDraft`'s own doc describes. Caught
  // internally (see `enqueue`) so one failed request can never permanently wedge the lane.
  const writes = useSerialWrites();
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPendingAtRef = useRef<number | null>(null);
  // The newest draft handed to `scheduleAutosave` that has NOT yet been written — what a flush
  // sends. A ref, not the timer's own closure, precisely so an exit event can reach it: the
  // closure is unreachable from outside the `setTimeout` callback, which is why cancelling the
  // timer used to be indistinguishable from losing the edit.
  const pendingDraftRef = useRef<StandingDraftAutosaveInput | null>(null);
  // The lowest `baseVersion` a write may still carry for the current entry — see `supersedeBasis`.
  // `null` until the caller supersedes a basis; reset on an entry change, because another entry's
  // version numbers are unrelated.
  const minBaseVersionRef = useRef<number | null>(null);

  return { backupPrincipalId, latestDraftRef, backupGenerationRef, recoverableDraft, setRecoverableDraft, staleBasis, setStaleBasis, staleBasisRef, backupEntryIdRef, writes, idleTimerRef, firstPendingAtRef, pendingDraftRef, minBaseVersionRef };
}

export function useStandingDraftTimer(state: ReturnType<typeof useStandingDraftState>) {
  const { idleTimerRef, firstPendingAtRef, pendingDraftRef } = state;
  const clearPendingTimer = useCallback(() => {
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
    firstPendingAtRef.current = null;
    pendingDraftRef.current = null;
  }, []);

  return clearPendingTimer;
}

export function useStandingDraftQueue(state: ReturnType<typeof useStandingDraftState>) {
  const { writes } = state;
  const enqueue = useCallback(
    (op: () => Promise<void>): Promise<void> =>
      writes.run({ task: op }).catch(() => {
        // best-effort background persistence; surfaced to
        // the console rather than the operator, who has nothing actionable to do about one dropped
        // autosave tick, and rather than thrown, which would wedge every later tick on this chain.
        createConsoleLogger({ prefix: '' }).error({ message: "standing-draft autosave: request failed" });
      }),
    [writes]
  );

  return enqueue;
}
