import type { StandingDraftAutosaveSnapshot, StandingDraftStaleBasis } from "@jini-ai/ui/panel-kit";
import type { ComponentProps, ReactNode } from "react";
import type { PageExternalChangeBanner as PageExternalChangeBannerType } from "../../../pages/PageExternalChangeBanner.js";
import type { standingDraftRecoveryMessage as standingDraftRecoveryMessageType } from "@jini-ai/ui/panel-kit";
import { type PostSaveConflict, postAutosaveStaleBasisMessage, postVersionConflictMessage } from "../../post-editor-rules.js";
import { type Translate } from "@jini-ai/core/text";

/** The host's injected notice components, typed by the props this composer passes them. */
type PostAutosaveRecoveryBannerComponent = (props: {
  recoverableDraft: StandingDraftAutosaveSnapshot; serverUpdatedAt: string; onRestore: () => void; onDiscard: () => void;
  t: Translate; standingDraftRecoveryMessage: typeof standingDraftRecoveryMessageType;
}) => ReactNode;
type PostAutosaveStaleBannerComponent = (props: { staleBasis: StandingDraftStaleBasis; staleBasisMessage: (staleBasis: StandingDraftStaleBasis) => string }) => ReactNode;
type PostVersionConflictBannerComponent = (props: {
  saveConflict: PostSaveConflict; versionConflictMessage: (conflict: PostSaveConflict) => string;
  onSaveAnyway: () => void; onLoadLatest: () => void; onDismiss: () => void; t: Translate;
}) => ReactNode;

/**
 * The four "something happened to your work" notices, grouped into one component so their four
 * independent render decisions are scored in this scope instead of accumulating onto `PostEditor`'s
 * — the same extraction `PostEditorHeader`/`PostEditorActions` above already document, and the
 * reason this exists at all: adding the stale-basis notice put `PostEditor` at a complexity of 10
 * against this repo's ceiling of 9.
 *
 * Deliberately NOT merged into a single "pick the most important one" banner. All four can be true
 * at once and each reports a different fact with a different remedy — see `PostAutosaveStaleBanner`'s
 * own doc for the distinction. Suppressing one because another is showing would put the operator
 * back to guessing which of their edits actually survived.
 *
 * One exception (UI check 2026-10-31): the stale-basis notice waits while the outside-change notice
 * is up. Both report the same event — the stored version moved past this editor's basis — and two
 * stacked banners for one assistant save read as two problems. The outside-change notice carries
 * the choices; if the operator keeps their edits it goes, and the stale-basis notice (still true:
 * autosaving is paused) comes back.
 *
 * Order is deliberate: recovery (work from a previous session, an explicit choice to make) first,
 * then the stale-basis notice (a condition still true right now), then the rejected save (the most
 * recent thing the operator personally did), then the outside change awaiting a choice.
 */
export function PostEditorNotices({
  recoverableDraft,
  serverUpdatedAt,
  restoreRecoveredDraft,
  discardRecoveredDraft,
  autosaveStaleBasis,
  saveConflict,
  saveOverwritingConflict,
  dismissSaveConflict,
  pendingExternalVersion,
  loadExternalChange,
  dismissExternalChange,
  t, PostAutosaveRecoveryBanner, PostAutosaveStaleBanner, PostVersionConflictBanner, PageExternalChangeBanner, standingDraftRecoveryMessage, pageExternalChangeBindings,
}: {
  PostAutosaveRecoveryBanner: PostAutosaveRecoveryBannerComponent;
  PostAutosaveStaleBanner: PostAutosaveStaleBannerComponent;
  PostVersionConflictBanner: PostVersionConflictBannerComponent;
  PageExternalChangeBanner: typeof PageExternalChangeBannerType;
  standingDraftRecoveryMessage: typeof standingDraftRecoveryMessageType;
  pageExternalChangeBindings: Pick<ComponentProps<typeof PageExternalChangeBannerType>, "agentHandle" | "copy">;
  recoverableDraft: StandingDraftAutosaveSnapshot | null;
  serverUpdatedAt: string;
  restoreRecoveredDraft: () => void;
  discardRecoveredDraft: () => Promise<void>;
  autosaveStaleBasis: StandingDraftStaleBasis | null;
  saveConflict: PostSaveConflict | null;
  saveOverwritingConflict: () => Promise<void>;
  dismissSaveConflict: () => void;
  pendingExternalVersion: number | null;
  loadExternalChange: () => Promise<void>;
  dismissExternalChange: () => void;
  t: Translate;
}, _optional = {}) {
  return (
    <>
      {recoverableDraft ? (
        <PostAutosaveRecoveryBanner
          recoverableDraft={recoverableDraft}
          serverUpdatedAt={serverUpdatedAt}
          onRestore={restoreRecoveredDraft}
          onDiscard={discardRecoveredDraft}
          t={t}
          standingDraftRecoveryMessage={standingDraftRecoveryMessage}
        />
      ) : null}
      {autosaveStaleBasis && pendingExternalVersion == null && !saveConflict ? <PostAutosaveStaleBanner staleBasis={autosaveStaleBasis} staleBasisMessage={postAutosaveStaleBasisMessage} /> : null}
      {saveConflict ? (
        <PostVersionConflictBanner
          saveConflict={saveConflict}
          versionConflictMessage={postVersionConflictMessage}
          onSaveAnyway={() => void saveOverwritingConflict()}
          onLoadLatest={() => void loadExternalChange()}
          onDismiss={() => { dismissSaveConflict(); dismissExternalChange(); }}
          t={t}
        />
      ) : null}
      {pendingExternalVersion != null && !saveConflict ? (
        <PageExternalChangeBanner onLoadLatest={() => void loadExternalChange()} onKeepEdits={dismissExternalChange} t={t} {...pageExternalChangeBindings} />
      ) : null}
    </>
  );
}
