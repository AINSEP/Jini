import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { PageEditorProps } from "./PageEditor.js";
import type { PageEditorController } from "./hooks/use-page-editor.hooks.js";
import type { StandingDraftAutosaveSnapshot, StandingDraftStaleBasis } from "../react/kit.js";
import type { SaveConflict as PageSaveConflict } from "../shell/lib/version-conflict.js";
import { pageAutosaveStaleBasisMessage, pageVersionConflictMessage } from "./page-editor-rules.js";

/**
 * Standing-draft autosave (2026-09-06) — the "restore or discard" recovery banner. Never rendered
 * unless `usePageEditor` found a parked draft on mount (`recoverableDraft`); never applies it on its
 * own — both buttons require an explicit click, per the owner's own worry about silently clobbering
 * a different tab/operator's work. `standingDraftRecoveryMessage` (`@jini-ai/ui/panel-kit`)
 * owns the actual wording decision so this component stays markup only.
 */
export function PageAutosaveRecoveryBanner({ deps, recoverableDraft, serverUpdatedAt, onRestore, onDiscard, t }: { deps: PageEditorProps["deps"];
  recoverableDraft: StandingDraftAutosaveSnapshot;
  serverUpdatedAt: string;
  onRestore: () => void;
  onDiscard: () => void;
  t: Translate;
}, _optional = {}) {
  const { standingDraftRecoveryMessage } = deps;
  return (
    <div
      className="notice warning"
      {...agentHandle({ handle: "page-autosave-recovery" }, {
        role: "region",
        label: "An unsaved draft from a previous session was found — restore it or discard it",
      })}
    >
      <p>{standingDraftRecoveryMessage({ draft: recoverableDraft, t, serverUpdatedAt })}</p>
      <PageAutosaveRestoreButton onRestore={onRestore} t={t} />
      <button
        type="button"
        className="btn-secondary"
        onClick={onDiscard}
        {...agentHandle({ handle: "page-autosave-discard" }, { role: "button", label: "Discard the recovered draft without applying it" })}
      >
        {t("Discard")}
      </button>
    </div>
  );
}

/**
 * The VERSION-CONFLICT banner (2026-09-07) — an EXPLICIT Save/Publish the server rejected, with a
 * way past it. Mirrors `features/posts/PostEditor.tsx`'s `PostVersionConflictBanner`.
 *
 * Distinct from `PageAutosaveStaleBanner` below, which reports the same collision hitting the
 * BACKGROUND autosave: that one is a state the operator never asked for and gets no buttons, this
 * one is a button they pressed and watched fail, so it owes them an answer. `pageVersionConflict
 * Message` (`rules.ts`) owns the wording so this component stays markup only.
 *
 * "Save anyway" is the only way past the conflict, and that is on purpose: the plain Save button
 * keeps failing until the operator explicitly chooses to replace the other version. Copy is
 * hardcoded English, matching every other string in this file — `PageEditor.tsx` is out of the
 * pages dictionary's declared scope (see `pages-i18n.ts`'s own header).
 */
export function PageVersionConflictBanner({ saveConflict, onSaveAnyway, onLoadLatest, onDismiss, t }: {
  saveConflict: PageSaveConflict;
  onSaveAnyway: () => void;
  onLoadLatest: () => void;
  onDismiss: () => void;
  t: Translate;
}, _optional = {}) {
  return (
    <div
      className="notice error"
      {...agentHandle({ handle: "page-version-conflict" }, {
        role: "region",
        label: "Another operator saved this while you were editing — your changes are unsaved and still in the editor",
      })}
    >
      <p>{pageVersionConflictMessage({ t, ...saveConflict })}</p>
      <p>{t("Loading the latest version discards your unsaved edits.")}</p>
      <button type="button" className="btn-secondary" onClick={onLoadLatest} {...agentHandle({ handle: "page-version-conflict-load-latest" }, { role: "button", label: "Load latest version, discarding my unsaved edits" })}>{t("Load latest")}</button>
      <PageVersionConflictOverwrite onSaveAnyway={onSaveAnyway} t={t} />
      <PageVersionConflictDismiss onDismiss={onDismiss} t={t} />
    </div>
  );
}

/**
 * Standing-draft autosave — the STALE-BASIS notice (2026-09-06). The counterpart to
 * `PageAutosaveRecoveryBanner` above and not a duplicate of it: that banner offers work found parked
 * from a PREVIOUS session, this reports that background autosaving has STOPPED for the session
 * happening right now, because another operator's save moved this page's version out from under this
 * tab. Until then the operator had no way to know — the editor looked completely normal while every
 * write it made was being thrown away. `pageAutosaveStaleBasisMessage` (`rules.ts`) owns the wording
 * so this component stays markup only, the same split the recovery banner already uses.
 *
 * NO buttons, deliberately, and this is the one design decision here worth defending:
 * - A "Dismiss" would let the operator silence a warning that is still true, putting them straight
 *   back into the silent data loss this whole path exists to end. The notice clears by itself when
 *   autosaving actually resumes (`usePageEditor`'s `autosaveStaleBasis` goes null once a write is
 *   accepted on a fresh basis) and at no other time, so it can never be lying while it is on screen.
 * - A "Reload" would wipe the operator's typed text out of the editor on their behalf. Their only
 *   remaining copy would then be the shared hook's best-effort browser-storage mirror, which is not
 *   a guarantee this component can make on their behalf (`localStorage` throws outright in some
 *   privacy modes). The message tells them to copy their work first and leaves the choice with them.
 */
export function PageAutosaveStaleBanner({ staleBasis, t }: { staleBasis: StandingDraftStaleBasis; t: Translate }, _optional = {}) {
  return (
    <div
      className="notice warning"
      {...agentHandle({ handle: "page-autosave-stale" }, {
        role: "region",
        label:
          "Another operator saved this page while you were editing — autosaving has stopped, and your " +
          "unsaved changes are still here in the editor",
      })}
    >
      <p>{pageAutosaveStaleBasisMessage({ t, ...staleBasis })}</p>
    </div>
  );
}

/**
 * The four "something happened to your work" notices, grouped into one component so their four
 * independent render decisions are scored in this scope instead of accumulating onto `PageEditor`'s
 * own complexity — same extraction `features/posts/PostEditor.tsx`'s `PostEditorNotices` already
 * makes, added there for the identical reason (recovery/stale-basis/conflict already put that
 * component over the ceiling; a fourth notice here would do the same to this one).
 *
 * Order: recovery (work from a previous session) first, then the stale-basis notice (a condition
 * still true right now), then the rejected save (the most recent thing the operator personally did),
 * then the external-change notice last (the newest kind, and the only one whose trigger — an
 * assistant write — has nothing to do with what the operator themselves just did). All four can be
 * true at once; none is suppressed in favor of another.
 */
export function PageEditorNotices({ kit, deps,
  recoverableDraft,
  serverUpdatedAt,
  onRestore,
  onDiscard,
  autosaveStaleBasis,
  saveConflict,
  onSaveAnyway,
  onDismissConflict,
  pendingExternalVersion,
  onLoadExternalChange,
  onDismissExternalChange,
  t,
}: { kit: PageEditorProps["kit"]; deps: PageEditorProps["deps"];
  recoverableDraft: StandingDraftAutosaveSnapshot | null;
  serverUpdatedAt: string;
  onRestore: () => void;
  onDiscard: () => void;
  autosaveStaleBasis: StandingDraftStaleBasis | null;
  saveConflict: PageSaveConflict | null;
  onSaveAnyway: () => void;
  onDismissConflict: () => void;
  pendingExternalVersion: number | null;
  onLoadExternalChange: () => void;
  onDismissExternalChange: () => void;
  t: Translate;
}, _optional = {}) {
  return (
    <>
      {recoverableDraft ? (
        <PageAutosaveRecoveryBanner deps={deps}
          recoverableDraft={recoverableDraft}
          serverUpdatedAt={serverUpdatedAt}
          onRestore={onRestore}
          onDiscard={onDiscard}
          t={t}
        />
      ) : null}
      {/* Waits while the outside-change notice is up: one moved version, one banner — see `PostEditorNotices`. */}
      {autosaveStaleBasis && pendingExternalVersion === null && !saveConflict ? <PageAutosaveStaleBanner staleBasis={autosaveStaleBasis} t={t} /> : null}
      <PageEditorChangeNotices kit={kit} deps={deps} saveConflict={saveConflict} onSaveAnyway={onSaveAnyway} onLoadExternalChange={onLoadExternalChange} onDismissConflict={onDismissConflict} onDismissExternalChange={onDismissExternalChange} pendingExternalVersion={pendingExternalVersion} t={t} />
    </>
  );
}

function PageAutosaveRestoreButton({ onRestore, t }: Pick<Parameters<typeof PageAutosaveRecoveryBanner>[0], "onRestore" | "t">, _optional = {}) {
  return (
    <button
        type="button"
        className="btn-secondary"
        onClick={onRestore}
        {...agentHandle({ handle: "page-autosave-restore" }, { role: "button", label: "Apply the recovered draft into the editor" })}
      >
        {t("Restore")}
      </button>
  );
}

function PageVersionConflictOverwrite({ onSaveAnyway, t }: Pick<Parameters<typeof PageVersionConflictBanner>[0], "onSaveAnyway" | "t">, _optional = {}) {
  return (
    <button
        type="button"
        className="btn-secondary"
        onClick={onSaveAnyway}
        {...agentHandle({ handle: "page-version-conflict-overwrite" }, {
          role: "button",
          label: "Save these changes anyway, replacing the version the other operator saved",
        })}
      >
        {t("Replace their version")}
      </button>
  );
}

function PageVersionConflictDismiss({ onDismiss, t }: Pick<Parameters<typeof PageVersionConflictBanner>[0], "onDismiss" | "t">, _optional = {}) {
  return (
    <button
        type="button"
        className="btn-secondary"
        onClick={onDismiss}
        {...agentHandle({ handle: "page-version-conflict-dismiss" }, {
          role: "button",
          label: "Hide this notice and keep editing without saving",
        })}
      >
        {t("Keep editing")}
      </button>
  );
}

export function PageEditorNoticesSection({ editor, page, kit, deps }: { editor: PageEditorController; page: NonNullable<PageEditorController["page"]>; kit: PageEditorProps["kit"]; deps: PageEditorProps["deps"] }, _optional = {}) {
  const { saveConflict, saveOverwritingConflict, dismissSaveConflict, recoverableDraft, restoreRecoveredDraft, discardRecoveredDraft, autosaveStaleBasis, pendingExternalVersion, loadExternalChange, dismissExternalChange, t } = editor;
  return (
    <PageEditorNotices kit={kit} deps={deps}
        recoverableDraft={recoverableDraft}
        serverUpdatedAt={page.updatedAt}
        onRestore={restoreRecoveredDraft}
        onDiscard={discardRecoveredDraft}
        autosaveStaleBasis={autosaveStaleBasis}
        saveConflict={saveConflict}
        onSaveAnyway={() => void saveOverwritingConflict()}
        onDismissConflict={dismissSaveConflict}
        pendingExternalVersion={pendingExternalVersion}
        onLoadExternalChange={() => void loadExternalChange()}
        onDismissExternalChange={dismissExternalChange}
        t={t}
      />
  );
}

function PageEditorChangeNotices({ kit, deps, saveConflict, onSaveAnyway, onLoadExternalChange, onDismissConflict, onDismissExternalChange, pendingExternalVersion, t }: Pick<Parameters<typeof PageEditorNotices>[0], "kit" | "deps" | "saveConflict" | "onSaveAnyway" | "onLoadExternalChange" | "onDismissConflict" | "onDismissExternalChange" | "pendingExternalVersion" | "t">, _optional = {}) {
  const { PageExternalChangeBanner } = kit;
  const { pageExternalChangeBindings } = deps;
  return (
    <>
      {saveConflict ? (
        <PageVersionConflictBanner saveConflict={saveConflict} onSaveAnyway={onSaveAnyway} onLoadLatest={onLoadExternalChange} onDismiss={() => { onDismissConflict(); onDismissExternalChange(); }} t={t} />
      ) : null}
      {pendingExternalVersion !== null && !saveConflict ? (
        <PageExternalChangeBanner onLoadLatest={onLoadExternalChange} onKeepEdits={onDismissExternalChange} t={t} {...pageExternalChangeBindings} />
      ) : null}
    </>
  );
}
