import { agentHandle } from "@jini-ai/core/agent-handles";
import { type Translate } from "@jini-ai/core/text";

/**
 * Optimistic concurrency (2026-09-06) — the "someone else saved while you were editing" banner.
 * Rendered only after a save was actually rejected with `409 VERSION_CONFLICT`; never on load, and
 * never for the slug-uniqueness 409 the same route can also return (see the host's
 * `readVersionConflict` for the distinction the server's `code` makes possible).
 *
 * Deliberately does NOT show the other operator's content, offer a diff, or replace anything in the
 * editor: the operator's own typed work is still on screen untouched, which is the single most
 * important property of this whole path. The host's injected `versionConflictMessage` owns the
 * wording so this component stays markup only, same split `PostAutosaveRecoveryBanner` above already uses.
 *
 * "Save anyway" is the only way past the conflict, and that is on purpose: the plain Save button
 * keeps failing until the operator explicitly chooses to replace the other version.
 *
 * `versionConflictMessage` is injected (K5): the sentence is host-owned interpolated copy. Generic
 * over the host's conflict type, which this component only hands back to that function.
 */
export function PostVersionConflictBanner<TConflict>({
  saveConflict,
  versionConflictMessage,
  onSaveAnyway,
  onLoadLatest,
  onDismiss,
  t,
}: {
  saveConflict: TConflict;
  versionConflictMessage: (conflict: TConflict) => string;
  onSaveAnyway: () => void;
  onLoadLatest: () => void;
  onDismiss: () => void;
  t: Translate;
}) {
  return (
    <div
      className="jini-post-notice jini-post-notice--error"
      {...agentHandle({ handle: "post-version-conflict" }, {
        role: "region",
        label: "Another operator saved this while you were editing — your changes are unsaved and still in the editor",
      })}
    >
      <p>{versionConflictMessage(saveConflict)}</p>
      <p>{t("Loading the latest version discards your unsaved edits.")}</p>
      <button type="button" className="jini-post-notice__btn" onClick={onLoadLatest}>{t("Load latest")}</button>
      <button
        type="button"
        className="jini-post-notice__btn"
        onClick={onSaveAnyway}
        {...agentHandle({ handle: "post-version-conflict-overwrite" }, {
          role: "button",
          label: "Save these changes anyway, replacing the version the other operator saved",
        })}
      >
        {t("Replace their version")}
      </button>
      <button
        type="button"
        className="jini-post-notice__btn"
        onClick={onDismiss}
        {...agentHandle({ handle: "post-version-conflict-dismiss" }, {
          role: "button",
          label: "Hide this notice and keep editing without saving",
        })}
      >
        {t("Keep editing")}
      </button>
    </div>
  );
}
