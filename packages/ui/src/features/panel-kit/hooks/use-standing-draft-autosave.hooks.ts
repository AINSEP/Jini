import { useMemo } from "react";
import type { createStandingDraftLocalBackup } from "../helpers/standing-draft-local-backup.js";
import { useStandingDraftState as useStandingDraftStateDefault, useStandingDraftTimer as useStandingDraftTimerDefault, useStandingDraftQueue as useStandingDraftQueueDefault } from "./use-standing-draft-state.hooks.js";
import { useStandingDraftStaleBasis as useStandingDraftStaleBasisDefault, useStandingDraftRecovery as useStandingDraftRecoveryDefault, useStandingDraftFailedSave as useStandingDraftFailedSaveDefault } from "./use-standing-draft-recovery.hooks.js";
import { useStandingDraftWriter as useStandingDraftWriterDefault, useStandingDraftSchedule as useStandingDraftScheduleDefault, useStandingDraftExitFlush as useStandingDraftExitFlushDefault, useStandingDraftDiscard as useStandingDraftDiscardDefault } from "./use-standing-draft-writes.hooks.js";

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
   *
   * Resolves `discarded: false` when the server refused or could not be reached. By default the
   * banner and the local copy are already gone, so the caller tells the person the draft may come
   * back. With `keepOnFailure` (the recovered-draft Discard button) the banner, the local copy and
   * the stale gate stay until the server confirms, so a failed discard never hides a draft that is
   * still there and the person can retry.
   */
  clearStandingDraft: (required?: Record<string, never>, optional?: { keepOnFailure?: boolean }) => Promise<{ discarded: boolean }>;
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

export function useStandingDraftAutosave(deps: StandingDraftAutosaveOptions, _options: Record<string, never> = {}, hooks = {
  useStandingDraftState: useStandingDraftStateDefault,
  useStandingDraftTimer: useStandingDraftTimerDefault,
  useStandingDraftStaleBasis: useStandingDraftStaleBasisDefault,
  useStandingDraftRecovery: useStandingDraftRecoveryDefault,
  useStandingDraftQueue: useStandingDraftQueueDefault,
  useStandingDraftFailedSave: useStandingDraftFailedSaveDefault,
  useStandingDraftWriter: useStandingDraftWriterDefault,
  useStandingDraftSchedule: useStandingDraftScheduleDefault,
  useStandingDraftExitFlush: useStandingDraftExitFlushDefault,
  useStandingDraftDiscard: useStandingDraftDiscardDefault,
}): StandingDraftAutosaveController {
  const {
    useStandingDraftState, useStandingDraftTimer, useStandingDraftStaleBasis, useStandingDraftRecovery, useStandingDraftQueue,
    useStandingDraftFailedSave, useStandingDraftWriter, useStandingDraftSchedule, useStandingDraftExitFlush, useStandingDraftDiscard,
  } = hooks;
  const { port, backup, entryId, enabled, serverUpdatedAt } = deps;
  const dependencies = { port, backup, entryId, enabled, serverUpdatedAt };
  const state = useStandingDraftState(dependencies);
  const { recoverableDraft, staleBasis } = state;
  const clearPendingTimer = useStandingDraftTimer(state);
  const stale = useStandingDraftStaleBasis(state, dependencies);
  useStandingDraftRecovery(state, dependencies);
  const enqueue = useStandingDraftQueue(state);
  const preserveFailedSave = useStandingDraftFailedSave(state, dependencies);
  const writeAutosave = useStandingDraftWriter(state, dependencies, { ...stale, enqueue, preserveFailedSave });
  const { scheduleAutosave, flushPendingAutosave } = useStandingDraftSchedule(state, dependencies, { ...stale, clearPendingTimer, writeAutosave });
  useStandingDraftExitFlush(dependencies, flushPendingAutosave);
  const { clearStandingDraft, dismissRecoverable, supersedeBasis } = useStandingDraftDiscard(state, dependencies, { ...stale, enqueue, clearPendingTimer });
  const comparedDraft = useMemo(() => recoverableDraft ? { ...recoverableDraft, serverUpdatedAt } : null, [recoverableDraft, serverUpdatedAt]);
  return { recoverableDraft: comparedDraft, staleBasis, dismissRecoverable, scheduleAutosave, clearStandingDraft, supersedeBasis, preserveFailedSave };
}
