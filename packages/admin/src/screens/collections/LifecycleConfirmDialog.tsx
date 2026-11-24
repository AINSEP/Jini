import { type AdminContentType } from "./api/collections-api.types.js";
import { Dialog } from "../../react/kit.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { LifecycleConfirmDialogController } from "./hooks/use-lifecycle-confirm-dialog.hooks.js";
import type { LifecycleConfirmOp } from "./rules.js";


// ---------------------------------------------------------------------------
// Lifecycle confirm dialog (Deprecate / Reactivate / Tombstone — design-spec.md §1.3/§1.8)
// ---------------------------------------------------------------------------

export interface LifecycleConfirmDialogProps {
  op: LifecycleConfirmOp;
  contentType: AdminContentType;
  onConfirm: () => void;
  onCancel: () => void;
  /** The dialog's copy/focus hook. The host binds `useLifecycleConfirmDialog` to its locale and
   *  collections kit (a test passes a fake); see `PostsProps.usePostsHook` for the convention. */
  useLifecycleConfirmDialogHook: (props: { op: LifecycleConfirmOp; onCancel: () => void }) => LifecycleConfirmDialogController;
  /** Translator closure — see `Collections()`'s own `t`. */
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}

/**
 * Confirms a content type's Deprecate/Tombstone. The host imports its native-dialog stylesheet at
 * the screen mount; this component emits only `jini-*` classes (`jini-collections-dialog` is the
 * host-styled dialog shell).
 */
export function LifecycleConfirmDialog(props: LifecycleConfirmDialogProps) {
  const { op, contentType, onConfirm, onCancel, t } = props;
  const { copy, autoFocusCancel } = props.useLifecycleConfirmDialogHook({ op, onCancel });

  return (
    <Dialog open title={copy.title} onClose={() => onCancel()} className="jini-collections-dialog jini-domain-dialog">
        <p>
          {copy.body} (<strong>{contentType.label}</strong>)
        </p>
        <span className="jini-editor-actions">
          {/* Deprecate is reversible (Reactivate exists) but access-affecting — `.jini-btn-warning`,
              same distinction as Users.tsx's Disable. Tombstone is not, per its own copy above
              ("not reversible from this screen") — `.jini-btn-danger`, matching Roles.tsx/redirects/react/pages/RedirectsPage.tsx's
              existing destructive-delete convention. */}
          <button
            type="button"
            className={op === "deprecate" ? "jini-btn-warning" : "jini-btn-danger"}
            data-jini-autofocus={autoFocusCancel ? undefined : ""}
            onClick={onConfirm}
            {...agentHandle({ handle: "lifecycle-confirm" }, {
              role: "button",
              label:
                "Confirm this content type's lifecycle change — Deprecate is reversible, Tombstone is not from this screen",
            })}
          >
            {op === "deprecate" ? t({ key: "Deprecate" }) : t({ key: "Delete" })}
          </button>
          <button
            type="button"
            className="jini-btn-secondary"
            data-jini-autofocus={autoFocusCancel ? "" : undefined}
            onClick={onCancel}
            {...agentHandle({ handle: "lifecycle-cancel" }, { role: "button", label: "Close this dialog without changing the lifecycle" })}
          >
            {t({ key: "Cancel" })}
          </button>
        </span>
    </Dialog>
  );
}
