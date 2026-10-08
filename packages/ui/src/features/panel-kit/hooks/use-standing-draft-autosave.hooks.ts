import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSerialWrites } from "./use-serial-writes.hooks.js";
import type { createStandingDraftLocalBackup } from "../helpers/standing-draft-local-backup.js";
/**
 * @file Standing-draft autosave (2026-09-06 dispatch, owner's own words: "even if they haven't
 * saved it, temp save it whenever they make a draft... it's just saving to... the database. It
 * should be a standing draft anytime something is updated"). Persists to the server
 * (`server/inbound/admin-http/routes/posts/autosave.ts`, `posts.autosave_json`) so a reload or an
 * accidental exit never loses unsaved edits — browser storage alone was rejected.
 *
 * Feature-agnostic on purpose, matching `use-dirty-guard.hooks.ts`'s own precedent: nothing here
 * imports `features/posts` or `features/pages`, so `PostEditorPort`/`PageEditorPort` each satisfy
 * {@link StandingDraftAutosavePort} structurally (same three method shapes, declared independently
 * per that DI-seam convention) with zero cross-feature import. This is the mechanism that lets one
 * implementation serve both editors with no branch between them.
 *
 * Two things this hook does NOT do, deliberately:
 * - Never auto-applies a recovered draft. {@link StandingDraftAutosaveController.recoverableDraft}
 *   is exposed for the caller to render an explicit "restore or discard" banner; silently splicing
 *   in a recovered draft is dangerous with two tabs or two operators open on the same entry.
 * - Never compares `recoverableDraft.baseVersion` against the entry's current version itself — the
 *   caller (which already has the freshly-loaded record) decides whether to label a recovered draft
 *   "outdated" because a real save happened since it was captured.
 *
 * STALE BASIS (added 2026-09-06, fixing silent data loss). `putAutosave` answers `{ applied }`, and
 * `applied: false` means the row's `version` moved under this tab — another tab or operator saved,
 * so every further write against this basis will be refused too (the guard is
 * `host features/post/repo.sqlite.ts`'s `writeAutosave`). That flag used to be thrown
 * away: the hook kept firing refused ticks forever, nothing was ever parked, and a reload produced
 * no recovery banner because there was nothing to recover — an hour of typing could vanish with the
 * operator never told anything. Now a refusal:
 * 1. records {@link StandingDraftStaleBasis} (exposed so the editor can say something true),
 * 2. stops scheduling further writes until the caller supplies a draft on a DIFFERENT `baseVersion`
 *    — i.e. until the editor reloads the row; no manual reset call is needed,
 * 3. mirrors the refused text into `lib/standing-draft-local-backup.ts`, the only place it can
 *    survive a tab close while the server refuses it, and offers it back through the existing
 *    `recoverableDraft` banner on the next mount when the server has nothing parked.
 * The operator's in-memory text is never touched by any of this.
 *
 * The gate and the mirror have DIFFERENT lifetimes on purpose. The gate lifts the instant the
 * caller edits on a fresh basis; the mirror survives until the server has actually accepted a write
 * (or a real Save/discard superseded it), because between those two moments nothing has been
 * persisted anywhere and the mirror is still the only copy of the refused text that outlives the
 * tab. Collapsing the two back into one "clear it all" step reintroduces a window in which a failed
 * request loses the work.
 */

/** The fields a standing draft carries — see `PostAutosaveSnapshot`'s own server-side doc for why
 *  `status` is deliberately absent (a draft must never change whether a row is live). */
export type StandingDraftAutosaveInput =
  | { bodyFormat: "doc"; bodyJson: Record<string, unknown>; title: string; slug: string; baseVersion: number }
  | { bodyFormat: "html"; bodyHtml: string; title: string; slug: string; baseVersion: number };

export interface StandingDraftAutosaveSnapshot {
  bodyFormat: "doc" | "html";
  bodyJson?: Record<string, unknown>;
  bodyHtml?: string;
  title: string;
  slug: string;
  baseVersion: number;
  savedAt: string;
  savedByPrincipalId: string;
  /** Fresh server timestamp used only for the explicit recovery comparison. */
  serverUpdatedAt?: string | undefined;
}

/** What this hook needs from the outside world — see this file's header for why it is declared
 *  here rather than imported from either feature's own port. */
export interface StandingDraftAutosavePort {
  /** Captured before expiry so late failures cannot borrow the next operator's identity. */
  getBackupPrincipalId?: (requiredArgs: Record<string, never>, optionalArgs?: Record<string, never>) => string | null;
  /**
   * `options.keepalive` (2026-09-07) asks for an UNLOAD-SAFE transport, and is set only by the exit
   * flush below. An ordinary `fetch` started from `pagehide` or `visibilitychange`→hidden is
   * cancelled when the browser tears the document down — so the newest edit, the one still sitting
   * in the debounce window, was precisely the one those listeners could not actually rescue.
   *
   * Opt-in rather than always-on because `keepalive` carries a 64 KiB body ceiling an ordinary
   * request does not; an implementation that cannot honour it may ignore it (the parameter is
   * optional), which is exactly the behavior this path had before.
   */
  putAutosave(
    required: { id: string; draft: StandingDraftAutosaveInput },
    options?: { keepalive?: boolean }
  ): Promise<{ applied: boolean }>;
  getAutosave(required: { id: string }, optional?: Record<string, never>): Promise<{ autosave: StandingDraftAutosaveSnapshot | null }>;
  discardAutosave(required: { id: string }, optional?: Record<string, never>): Promise<{ ok: boolean }>;
}

/** A write the server refused because the row moved on — see this file's header. Carries the
 *  operator's refused text itself, not just a flag: it is the copy nothing else on the client has
 *  a claim to, and a conflict notice that drops the work would be worse than the silent drop. */
export interface StandingDraftStaleBasis {
  /** The `baseVersion` the refused draft was built on. The gate lifts when a later
   *  `scheduleAutosave` arrives on a different one. */
  baseVersion: number;
  /** Exactly what was refused. */
  draft: StandingDraftAutosaveInput;
}

export interface StandingDraftAutosaveController {
  /** Non-null once the mount-time recovery check resolves and finds a parked draft. Stays exactly
   *  as read until {@link dismissRecoverable}/{@link clearStandingDraft} clears it — never
   *  overwritten by a later `scheduleAutosave` tick from THIS session, since a session that is
   *  actively autosaving has, by definition, already accounted for whatever it found on mount. */
  recoverableDraft: StandingDraftAutosaveSnapshot | null;
  /** Non-null once the server has refused a write for this entry, and until the caller edits on a
   *  fresh basis (or a real Save/discard runs). While it is set, `scheduleAutosave` deliberately
   *  sends nothing — every such write would be refused. The editor should tell the operator that
   *  another save happened, that reloading is what resumes autosaving, and that their text is kept.
   *  Purely additive: a caller that ignores it behaves exactly as before EXCEPT that refused writes
   *  are no longer retried forever. */
  staleBasis: StandingDraftStaleBasis | null;
  /** Clears `recoverableDraft` locally only (no server call) — the "Discard" affordance calls
   *  {@link clearStandingDraft} instead, which also tells the server; this is for a caller that
   *  wants to stop showing the banner without discarding anything (e.g. "Restore" applied it into
   *  the editor, and a real Save moments later will clear the server-side draft on its own). */
  dismissRecoverable: () => void;
  /** Call on every content change the caller wants protected — cheap, debounced internally
   *  (idle 3s / 15s hard ceiling while continuously typing), safe to call on every keystroke.
   *  Whatever is still sitting in the debounce window when the editor goes away is written by the
   *  flush this hook wires up itself — see the `flushPendingAutosave` effects below. */
  scheduleAutosave: (draft: StandingDraftAutosaveInput) => void;
  /**
   * Clears the server-side standing draft — call after a real Save/Publish succeeds, or when the
   * operator explicitly discards a recovered draft. Cancels any pending (not yet fired) debounce
   * timer FIRST, then enqueues the discard onto the same serial request chain every
   * `scheduleAutosave` tick uses, so a still-in-flight (already fired) autosave write is guaranteed
   * to reach the server before this discard does, and no new one can be queued after it — the
   * ordering guarantee that keeps a late autosave from resurrecting content a real save (or an
   * explicit discard) just superseded.
   */
  clearStandingDraft: () => Promise<void>;
  /**
   * The caller replaced its basis with a newer saved row it did not write itself (an assistant
   * write applied by `use-external-entry-refresh.hooks.ts`, silently or through Load latest). Every
   * write built on an OLDER `baseVersion` is superseded from here on: a pending one is cancelled, a
   * later `scheduleAutosave` on one is dropped (a render that committed before the replacement can
   * still run its autosave effect after this call), and the refusal of one already in flight is
   * ignored. Without this, that write reached the server, was refused, paused autosaving and
   * mirrored text for a version the editor had already left (reviewer finding 2, 2026-09-16).
   *
   * A gate recorded on an older basis lifts, because the editor is no longer on it. That refusal's
   * mirror is kept: nothing has accepted its text anywhere (see this file's header). Does not touch
   * the server-side draft — Load latest also calls {@link clearStandingDraft} for that.
   */
  supersedeBasis: (baseVersion: number) => void;
  preserveFailedSave: (requiredArgs: { error: unknown; draft: StandingDraftAutosaveInput }, optionalArgs?: Record<string, never>) => void;
}

/** Idle debounce: fires this long after the LAST `scheduleAutosave` call with no further calls. */
const IDLE_DEBOUNCE_MS = 3000;
/** Hard ceiling while continuously typing: once this much time has passed since the first
 *  unflushed edit, the next tick fires immediately instead of resetting the idle window again. */
const MAX_WAIT_MS = 15000;

export interface StandingDraftAutosaveOptions {
  port: StandingDraftAutosavePort;
  backup: ReturnType<typeof createStandingDraftLocalBackup>;
  /** `null` before the entry has loaded (or for a not-yet-created entry) — every operation no-ops. */
  entryId: string | null;
  /** Gate for "this editor is in a state where autosave should run at all" (e.g. not while a save
   *  or delete is already in flight). Recovery-check and scheduling both respect it. */
  enabled: boolean;
  serverUpdatedAt?: string | undefined;
}

export function useStandingDraftAutosave(deps: StandingDraftAutosaveOptions, _options: Record<string, never> = {}): StandingDraftAutosaveController {
  const { port, backup, entryId, enabled, serverUpdatedAt } = deps;
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

  const clearPendingTimer = useCallback(() => {
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
    firstPendingAtRef.current = null;
    pendingDraftRef.current = null;
  }, []);

  /** The server refused this draft. Records the basis, and mirrors the text locally — the ONLY
   *  place it can survive a tab close while the server keeps refusing it. @complexity O(1). */
  const markStaleBasis = useCallback((id: string, draft: StandingDraftAutosaveInput) => {
    const next: StandingDraftStaleBasis = { baseVersion: draft.baseVersion, draft };
    staleBasisRef.current = next;
    setStaleBasis(next);
    backup.write({ entryId: id, draft, savedAt: new Date().toISOString() }, { principalId: backupPrincipalId });
    backupEntryIdRef.current = id;
  }, [backupPrincipalId, backup]);

  /** Lifts the gate so scheduling resumes. Does NOT touch the mirror — see this file's header for
   *  why those two are separate. No-op when nothing is stale, so the common path never re-renders.
   *  @complexity O(1). */
  const liftStaleGate = useCallback(() => {
    if (staleBasisRef.current === null) return;
    staleBasisRef.current = null;
    setStaleBasis(null);
  }, []);

  /** Drops the browser-storage mirror for the entry being edited, if it has one. Called only where
   *  the operator's text provably survives somewhere else — the server just accepted a write (so it
   *  is parked server-side), or a real Save/discard superseded it. @complexity O(1). */
  const dropLocalBackup = useCallback(() => {
    const id = backupEntryIdRef.current;
    if (id === null) return;
    backupEntryIdRef.current = null;
    backup.clear({ entryId: id }, { principalId: backupPrincipalId });
  }, [backupPrincipalId, backup]);

  // Mount-time (and entry-change) recovery check — one read, never repeated while this entryId
  // stays mounted. A stale in-flight response from a PREVIOUS entryId is dropped via `cancelled`.
  useEffect(() => {
    setRecoverableDraft(null);
    // A different entry is a different basis. A gate recorded for the PREVIOUS entryId must never
    // silence autosave for this one — their `version` numbers are very often both 1, so leaving it
    // set would silently stop autosaving an entry nobody has a conflict on. In-memory only: the
    // previous entry's local mirror is keyed under ITS id and stays recoverable there.
    staleBasisRef.current = null;
    setStaleBasis(null);
    // Same reasoning for the mirror pointer, one step further: the previous entry's mirror stays in
    // storage under ITS OWN key and stays recoverable there — only this hook's permission to drop a
    // mirror is reset, so a later accepted write for THIS entry cannot delete that other copy.
    backupEntryIdRef.current = null;
    minBaseVersionRef.current = null;
    latestDraftRef.current = null;
    if (!enabled || !entryId) return;
    let cancelled = false;
    port
      .getAutosave({ id: entryId }, {})
      .then((result) => {
        if (cancelled) return;
        const localBackup = backup.read({ entryId }, { principalId: backupPrincipalId });
        // Recorded whether or not it is the copy shown below: it exists, so a real Save or an
        // explicit discard on this entry has to be able to drop it. Without this the mirror written
        // before a reload would outlive every discard and re-offer itself on every later mount.
        if (localBackup !== null) backupEntryIdRef.current = entryId;
        // Historically server first — a parked draft is shared across tabs. For expiry recovery,
        // compare capture times instead: a 401 mirror may contain edits newer than that parked copy. The local
        // mirror is the fallback for exactly the case that produced it: the other tab's real save
        // cleared the server-side draft, so this tab reloads into "nothing to recover" while its
        // own refused text is the thing the operator actually wants back.
        const server = result.autosave;
        // A 401 mirror can be newer than the last accepted server autosave. Keep the newest copy.
        const newest = localBackup && (!server || localBackup.savedAt > server.savedAt) ? localBackup : server;
        setRecoverableDraft(newest);
      })
      .catch(() => {
        // A failed server recovery read must not hide the local copy rescued from an expired session.
        if (cancelled) return;
        const localBackup = backup.read({ entryId }, { principalId: backupPrincipalId });
        if (localBackup !== null) backupEntryIdRef.current = entryId;
        setRecoverableDraft(localBackup);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, entryId, port, backupPrincipalId, backup]);

  const enqueue = useCallback(
    (op: () => Promise<void>): Promise<void> =>
      writes.run({ task: op }).catch(() => {
        // eslint-disable-next-line no-console -- best-effort background persistence; surfaced to
        // the console rather than the operator, who has nothing actionable to do about one dropped
        // autosave tick, and rather than thrown, which would wedge every later tick on this chain.
        console.error("standing-draft autosave: request failed");
      }),
    [writes]
  );

  const preserveFailedSave = useCallback(({ error, draft }: { error: unknown; draft: StandingDraftAutosaveInput }, _options: Record<string, never> = {}) => {
    if (!entryId || !isUnauthorizedDraftWrite(error)) return;
    backup.write({ entryId, draft, savedAt: new Date().toISOString() }, { principalId: backupPrincipalId });
    backupEntryIdRef.current = entryId;
  }, [entryId, backupPrincipalId, backup]);

  /** The one place `putAutosave` is called. Its `{ applied }` answer is acted on here rather than
   *  discarded — see this file's STALE BASIS note. @complexity Time/space: O(1) plus the request. */
  const writeAutosave = useCallback(
    (id: string, draft: StandingDraftAutosaveInput, keepalive: boolean) => {
      const generation = backupGenerationRef.current;
      return enqueue(async () => {
        let result: { applied: boolean };
        try {
          result = await port.putAutosave({ id, draft }, { keepalive });
        } catch (error) {
          // A 401 can unmount the editor before this settles; the captured identity still owns it.
          // Use the newest scheduled text, since an older request may fail while typing continues.
          if (generation === backupGenerationRef.current) preserveFailedSave({ error, draft: latestDraftRef.current ?? draft });
          throw error;
        }
        if (generation !== backupGenerationRef.current) return;
        if (!result.applied) {
          // Refused because the caller already moved past this basis — nothing to pause or mirror.
          if (isSupersededBasis(draft.baseVersion, minBaseVersionRef.current)) return;
          markStaleBasis(id, draft);
          return;
        }
        // Accepted — the text is parked server-side now, which is the ONLY point at which the
        // mirror is redundant and may go.
        liftStaleGate();
        dropLocalBackup();
      });
    },
    [dropLocalBackup, enqueue, liftStaleGate, markStaleBasis, port, preserveFailedSave]
  );

  const scheduleAutosave = useCallback(
    (draft: StandingDraftAutosaveInput) => {
      if (!enabled || !entryId) return;
      latestDraftRef.current = draft;
      if (isSupersededBasis(draft.baseVersion, minBaseVersionRef.current)) return;
      // The gate. Same basis as the one the server already refused => this write would be refused
      // too, so it is not scheduled at all; a DIFFERENT basis means the editor reloaded the row, so
      // the gate lifts by itself and no caller has to remember to reset anything.
      const stale = staleBasisRef.current;
      if (stale !== null && stale.baseVersion === draft.baseVersion) return;
      // The mirror is deliberately left in place here: nothing has been written yet, so until the
      // server accepts, that mirror is still the only copy of the refused text that outlives the tab.
      liftStaleGate();
      const now = Date.now();
      if (firstPendingAtRef.current === null) firstPendingAtRef.current = now;
      const waitedSoFar = now - firstPendingAtRef.current;
      // Clamped, not a plain "already past the ceiling?" check: without the clamp, a call arriving
      // just before the ceiling would still schedule a FULL fresh `IDLE_DEBOUNCE_MS`, pushing the
      // actual fire time past `MAX_WAIT_MS` under continuous typing (verified by the ceiling test —
      // an unclamped version never fires within the window it claims to bound).
      const delay = Math.max(0, Math.min(IDLE_DEBOUNCE_MS, MAX_WAIT_MS - waitedSoFar));

      pendingDraftRef.current = draft;
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        firstPendingAtRef.current = null;
        pendingDraftRef.current = null;
        // Not an exit: the page is still here, so an ordinary fetch (no 64 KiB ceiling) is right.
        writeAutosave(entryId, draft, false);
      }, delay);
    },
    [enabled, entryId, liftStaleGate, writeAutosave]
  );

  /**
   * Writes a pending (not yet fired) autosave immediately instead of waiting the debounce out —
   * the half of the cadence that makes the owner's actual requirement true ("what if they reload
   * the page on accident or exit out of the page? I don't want them to lose their work"). The
   * debounce always leaves a window of up to {@link IDLE_DEBOUNCE_MS} in which the newest edit
   * exists only in React state; without this, every exit inside that window discards it.
   *
   * Goes onto the same serial chain every other write uses, so it can never overtake an in-flight
   * PUT or a discard already queued by {@link clearStandingDraft} — and because that function
   * nulls `pendingDraftRef`, a flush after a real Save is a no-op rather than a resurrection.
   *
   * @complexity Time/space: O(1) — one ref read and at most one enqueued request.
   */
  const flushPendingAutosave = useCallback(
    (keepalive: boolean) => {
      const draft = pendingDraftRef.current;
      if (draft === null || !entryId) return;
      clearPendingTimer();
      writeAutosave(entryId, draft, keepalive);
    },
    [clearPendingTimer, entryId, writeAutosave]
  );

  // Flush, do not cancel, when this editor goes away. An in-app navigation (the "Posts"/"Pages"
  // back link, or any router move) unmounts the hook while a debounced tick is still pending, and
  // the previous cancel-on-unmount is exactly how the last seconds of typing were lost — verified
  // in a real browser on 2026-09-06: typed into the Pages editor, followed the in-app link one
  // second later, and no PUT was ever issued. The SPA outlives the unmount, so the request started
  // here completes normally. Re-running on an `entryId` change is correct too: the cleanup closes
  // over the OUTGOING entry, so switching entries parks the one being left behind.
  // `keepalive: false` — an unmount is an in-app navigation, not a page teardown. The SPA outlives
  // it, so the request started here completes normally and must not pay keepalive's body ceiling.
  useEffect(() => () => flushPendingAutosave(false), [flushPendingAutosave]);

  // The exits React never sees. `pagehide` covers a tab close, a reload and a same-tab navigation;
  // `visibilitychange` covers a tab switch or the OS backgrounding the browser, where `pagehide`
  // may never fire; `blur` covers switching to another desktop app with the tab still visible.
  // `beforeunload` is deliberately NOT one of them — `use-dirty-guard.hooks.ts` already registers
  // it, and it is a PROMPT, not a persistence hook: answering "Leave" still discards whatever the
  // debounce had not written. Each handler is a no-op when nothing is pending, so overlapping
  // events (a close fires blur AND pagehide) cost one write, not three.
  useEffect(() => {
    if (!enabled || !entryId) return;
    // Wrapped rather than passed straight to `addEventListener`: a listener is called WITH the
    // Event, which would arrive as `flushPendingAutosave`'s `keepalive` argument — a truthy object,
    // so every flush would silently request keepalive whether or not it is an exit.
    const onExit = () => flushPendingAutosave(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPendingAutosave(true);
    };
    window.addEventListener("pagehide", onExit);
    window.addEventListener("blur", onExit);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onExit);
      window.removeEventListener("blur", onExit);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, entryId, flushPendingAutosave]);

  const clearStandingDraft = useCallback(async () => {
    // A late 401/refusal must not resurrect a draft a successful Save or Discard superseded.
    backupGenerationRef.current++;
    clearPendingTimer();
    setRecoverableDraft(null);
    // A real Save landed (or the operator discarded): whatever was refused is superseded, so the
    // gate lifts and the mirror goes with it — otherwise the next mount would offer a ghost. This
    // is also the ONLY thing that clears a mirror the operator has already been shown and chose to
    // discard, since by then the gate that wrote it belongs to a previous mount.
    liftStaleGate();
    dropLocalBackup();
    if (!entryId) return;
    await enqueue(async () => {
      await port.discardAutosave({ id: entryId }, {});
    });
  }, [clearPendingTimer, dropLocalBackup, enqueue, entryId, liftStaleGate, port]);

  const dismissRecoverable = useCallback(() => setRecoverableDraft(null), []);

  const supersedeBasis = useCallback(
    (baseVersion: number) => {
      minBaseVersionRef.current = baseVersion;
      const pending = pendingDraftRef.current;
      if (pending !== null && isSupersededBasis(pending.baseVersion, baseVersion)) clearPendingTimer();
      const stale = staleBasisRef.current;
      if (stale !== null && isSupersededBasis(stale.baseVersion, baseVersion)) liftStaleGate();
    },
    [clearPendingTimer, liftStaleGate]
  );

  const comparedDraft = useMemo(() => recoverableDraft ? { ...recoverableDraft, serverUpdatedAt } : null, [recoverableDraft, serverUpdatedAt]);
  return { recoverableDraft: comparedDraft, staleBasis, dismissRecoverable, scheduleAutosave, clearStandingDraft, supersedeBasis, preserveFailedSave };
}

/** Whether a write built on `baseVersion` belongs to a basis the caller has left (see
 *  `supersedeBasis`). @complexity O(1). */
function isSupersededBasis(baseVersion: number, minBaseVersion: number | null): boolean {
  return minBaseVersion !== null && baseVersion < minBaseVersion;
}

function isUnauthorizedDraftWrite(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 401;
}
