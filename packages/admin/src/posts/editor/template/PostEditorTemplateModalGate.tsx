import type { ComponentType } from "react";
import { type Translate } from "@jini-ai/core/text";

/** What the gate hands the host's template-source modal. `TTier` is the host's theme capability
 *  tier type; the gate only forwards it. */
export interface PostEditorTemplateSourceModalProps<TTier> {
  readonly themeId: string;
  readonly themeTier: TTier | null;
  readonly themeApiVersion: 2 | undefined;
  readonly templateFilename: string;
  readonly onClose: () => void;
  readonly confirmLeave: () => boolean;
  readonly t: Translate;
  readonly editAgentHandleId: string;
}

export interface PostEditorTemplateModalGateProps<TTier> {
  show: boolean;
  templateChoice: string | null;
  activeThemeId: string | null;
  activeThemeTier: TTier | null;
  activeThemeApiVersion: 2 | undefined;
  onClose: () => void;
  confirmLeave: () => boolean;
  t: Translate;
  /** The host's "View Template" source modal (required; the host binds its own). */
  TemplateSourceModal: ComponentType<PostEditorTemplateSourceModalProps<TTier>>;
}

/**
 * The "View Template" modal's mount gate — pulled out of `PostEditor` (complexity-ceiling pass,
 * 2026-08-20) as its own top-level function so the three-condition `&&` chain scores in its own
 * scope. Conditionally mounted, not always-mounted-with-`open`: `PreviewModalShell` (the shell
 * `TemplateSourceModal` renders through) is a plain fixed-position overlay `<div>`, not the native
 * `<dialog>` `ConfirmDialog` wraps — there is no `open` prop to toggle, so this follows
 * `AgentPluginDetailsModal`'s own call site (`AgentPlugins.tsx`) instead. `templateChoice` and
 * `activeThemeId` are re-checked here (not just at the "View Template" button's `disabled`) so this
 * can never render with an empty/`null` URL segment even if state changes out from under an
 * already-open modal.
 *
 * Wiring: the host injects its template-source modal as the required `TemplateSourceModal` prop.
 */
export function PostEditorTemplateModalGate<TTier>({
  show,
  templateChoice,
  activeThemeId,
  activeThemeTier,
  activeThemeApiVersion,
  onClose,
  confirmLeave,
  t,
  TemplateSourceModal,
}: PostEditorTemplateModalGateProps<TTier>) {
  if (!show || !templateChoice || !activeThemeId) return null;
  return (
    <TemplateSourceModal
      themeId={activeThemeId}
      themeTier={activeThemeTier}
      themeApiVersion={activeThemeApiVersion}
      templateFilename={templateChoice}
      onClose={onClose}
      confirmLeave={confirmLeave}
      t={t}
      editAgentHandleId="post-template-edit"
    />
  );
}
