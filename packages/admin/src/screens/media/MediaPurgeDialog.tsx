import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import type { MediaProps } from "./Media.js";

/** The purge-confirmation dialog — extracted out of `Media` for the same reason as
 *  `MediaToolbar`: its `pendingPurge`-derived `body`/`pending` expressions were two more of that
 *  component's independent branches. */
export function MediaPurgeDialog({
  pendingPurge,
  rowSavingId,
  onConfirm,
  onCancel,
  t, kit }: {
  pendingPurge: AdminMedia | null;
  rowSavingId: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  t: (key: string) => string;
} & Pick<MediaProps, "kit">, _optional = {}) {
  const { ConfirmDialog } = kit;
  return (
    <ConfirmDialog
      open={pendingPurge !== null}
      title={t("Delete permanently?")}
      body={
        pendingPurge ? (
          <p>
            {t("Permanently delete")} &quot;{pendingPurge.title}&quot;? {t("This cannot be undone.")}
          </p>
        ) : null
      }
      confirmLabel={t("Delete permanently")}
      destructive
      pending={pendingPurge !== null && rowSavingId === pendingPurge.id}
      onConfirm={onConfirm}
      onCancel={onCancel}
      agentHandle="media-purge"
    />
  );
}
