import type {
  StandingDraftAutosaveInput,
  StandingDraftAutosaveSnapshot,
} from "../hooks/use-standing-draft-autosave.hooks.js";

/**
 * @file Last-resort per-tab mirror for a standing draft the SERVER REFUSED (2026-09-06 stale-basis
 * fix). Deliberately NOT a general autosave backend — browser storage was explicitly rejected for
 * that (see `use-standing-draft-autosave.hooks.ts`'s header); this holds exactly one thing: the
 * text the server answered `applied: false` or HTTP 401 to, which it will keep refusing until the
 * editor reloads the row or the operator signs in again. Server-side parking is impossible for that text, so without this the
 * operator's only copy lives in a tab they may close at any moment.
 *
 * Written only on a refusal, read only as the mount-time fallback when the server has nothing
 * parked, and dropped the moment the server accepts a write again, the operator discards, or a real
 * Save lands. Every access is wrapped: `localStorage` throws outright in some privacy modes and on
 * quota exhaustion, and a failed backup must never break the editor it is protecting.
 *
 * Type-only import from the hook module — no runtime edge, and the hook keeps owning the shapes
 * both editors already import from it.
 */

/** Namespaced so one entry's backup can never collide with another's, or with unrelated app keys. */


/** Legacy marker for injected ports with no identity metadata — a recovered backup is identifiably
 *  local rather than pretending the server parked it. Production now uses the actual principal id
 *  captured by the session adapter. The legacy marker still keeps old fakes honest because
 *  {@link StandingDraftAutosaveSnapshot} requires the field; inventing a server principal would be
 *  the same class of defect this whole fix is about. */
export const LOCAL_BACKUP_PRINCIPAL_ID = "local-tab-backup";

/** Bind a profile-local refusal mirror without choosing the host's storage namespace.
 * Storage is obtained lazily inside guarded operations, so privacy-mode getters cannot break mount.
 * @complexity O(draft size) for reads/writes; O(1) for clears.
 */
export function createStandingDraftLocalBackup(
  { keyPrefix: KEY_PREFIX, getStorage }: { keyPrefix: string; getStorage: (required: Record<string, never>, optional?: Record<string, never>) => Pick<Storage, "getItem" | "setItem" | "removeItem"> },
  _options: Record<string, never> = {},
) {
  function keyFor(entryId: string, principalId?: string | null | undefined): string {
    return principalId === undefined ? `${KEY_PREFIX}${entryId}` : `${KEY_PREFIX}${encodeURIComponent(principalId ?? "")}.${encodeURIComponent(entryId)}`;
  }

  /** Mirrors a refused draft for this browser profile. Silent no-op on any storage failure.
   *  @complexity Time/space: O(size of the draft) for the one `JSON.stringify`. */
  function writeStandingDraftLocalBackup({ entryId, draft, savedAt }: { entryId: string; draft: StandingDraftAutosaveInput; savedAt: string }, options: { principalId?: string | null | undefined } = {}): void {
    if (options.principalId === null) return;
    const snapshot: StandingDraftAutosaveSnapshot = { ...draft, savedAt, savedByPrincipalId: options.principalId ?? LOCAL_BACKUP_PRINCIPAL_ID };
    try {
      const storage = getStorage({}, {});
      storage.setItem(keyFor(entryId, options.principalId), JSON.stringify(snapshot));
    } catch {
      // eslint-disable-next-line no-console -- best-effort; the operator's text is still in the tab.
      console.warn("standing-draft local backup: could not write");
    }
  }

  /** The mirrored draft, or `null` when there is none (or storage is unreadable/corrupt).
   *  @complexity Time/space: O(size of the stored draft). */
  function readStandingDraftLocalBackup({ entryId }: { entryId: string }, options: { principalId?: string | null | undefined } = {}): StandingDraftAutosaveSnapshot | null {
    if (options.principalId === null) return null;
    try {
      const storage = getStorage({}, {});
      const raw = storage.getItem(keyFor(entryId, options.principalId));
      return raw ? (JSON.parse(raw) as StandingDraftAutosaveSnapshot) : null;
    } catch {
      return null;
    }
  }

  /** Drops the mirror. Called on an accepted write, an explicit discard, and a real Save.
   *  @complexity Time/space: O(1). */
  function clearStandingDraftLocalBackup({ entryId }: { entryId: string }, options: { principalId?: string | null | undefined } = {}): void {
    if (options.principalId === null) return;
    try {
      const storage = getStorage({}, {});
      storage.removeItem(keyFor(entryId, options.principalId));
    } catch {
      // Nothing to do and nothing to tell the operator — a backup that cannot be removed is
      // superseded by the next write anyway, and is never auto-applied.
    }
  }

  return { write: writeStandingDraftLocalBackup, read: readStandingDraftLocalBackup, clear: clearStandingDraftLocalBackup };
}
