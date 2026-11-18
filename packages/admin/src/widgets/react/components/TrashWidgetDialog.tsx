import type { Translate } from "@jini-ai/core/text";
import { ConfirmDialog } from "../../../react/components/ConfirmDialog/ConfirmDialog.js";
import type { AdminWidget } from "../../models.js";

/** The confirm step before a widget moves to the trash (nothing is purged from here). */
export function TrashWidgetDialog(
  { t, pendingTrash, trashing, confirmTrash, cancelTrash }: {
    t: Translate; pendingTrash: AdminWidget | null; trashing: boolean; confirmTrash: () => void; cancelTrash: () => void;
  },
  _optional: Record<string, never> = {},
) {
  const pendingTrashTitle = pendingTrash?.title ?? "";
  return (
    <ConfirmDialog
      open={pendingTrash !== null}
      agentHandle="widgets-trash"
      title={t("Move to trash?")}
      body={pendingTrash ? <p>{t('Move "{title}" to trash?').replace("{title}", () => pendingTrashTitle)}</p> : null}
      confirmLabel={t("Move to trash")}
      destructive
      pending={trashing}
      onConfirm={confirmTrash}
      onCancel={cancelTrash}
    />
  );
}
