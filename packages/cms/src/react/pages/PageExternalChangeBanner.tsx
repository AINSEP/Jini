import type { AgentHandleOptions, AgentHandleProps } from "@jini-ai/core/agent-handles";
import { type Translate } from "@jini-ai/core/text";

type AgentAttrs = (
  required: { handle: string },
  optional?: AgentHandleOptions,
) => AgentHandleProps;

/**
 * The EXTERNAL-CHANGE notice (2026-09-16) — an assistant tool wrote a newer version of this page
 * while the editor had unsaved edits. A CLEAN editor applies the newer version silently instead (see
 * `use-external-entry-refresh.hooks.ts`); this banner exists only for the case a silent apply could
 * clobber unsaved work — which, on the Interactive tab, is always assumed, because canvas typing can
 * be invisible to `dirty` (see `pageRefreshMayHaveUnsavedEdits`, `rules.ts`).
 *
 * Distinct from `PageVersionConflictBanner` above: that one is a Save the operator pressed and
 * watched fail; this one is a background check that found the row moved before they ever pressed
 * Save. "Load latest" mirrors that banner's "Save anyway" in shape (an explicit, named action) but
 * opposite in effect — it discards the operator's edits rather than the other write.
 */
export function PageExternalChangeBanner({ onLoadLatest, onKeepEdits, t, agentHandle, copy }: { onLoadLatest: () => void; onKeepEdits: () => void; t: Translate; agentHandle: AgentAttrs; copy: { messageKey: string; regionAgentLabel: string; loadLatestAgentLabel: string; keepEditsAgentLabel: string } }) {
  return (
    <div
      className="notice warning"
      {...agentHandle({ handle: "page-external-change" }, {
        role: "region",
        label: copy.regionAgentLabel,
      })}
    >
      <p>{t(copy.messageKey)}</p>
      <button
        type="button"
        className="btn-secondary"
        onClick={onLoadLatest}
        {...agentHandle({ handle: "page-external-change-load-latest" }, {
          role: "button",
          label: copy.loadLatestAgentLabel,
        })}
      >
        {t("Load latest")}
      </button>
      <button
        type="button"
        className="btn-secondary"
        onClick={onKeepEdits}
        {...agentHandle({ handle: "page-external-change-keep-edits" }, {
          role: "button",
          label: copy.keepEditsAgentLabel,
        })}
      >
        {t("Keep my edits")}
      </button>
    </div>
  );
}
