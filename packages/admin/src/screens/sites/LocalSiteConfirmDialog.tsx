import { ConfirmDialog } from "../../react/components/ConfirmDialog/ConfirmDialog.js";
import type { ConfirmDialogProps } from "../../react/components/ConfirmDialog/ConfirmDialog.js";

/** The shared modal behind Move to Trash, Delete permanently and Switch now — focus trap, Escape,
 *  and focus back on the control that opened it come from `ConfirmDialog` itself. Renders nothing
 *  for a controller without one (test fakes, older callers). */
export function LocalSiteConfirmDialog({ dialog }: { dialog?: { dialog: ConfirmDialogProps } | undefined }) {
  if (!dialog) return null;
  return <ConfirmDialog {...dialog.dialog} agentHandle="sites-local-confirm" />;
}
