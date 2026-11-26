import { ConfirmDialog } from "../react/components/ConfirmDialog/ConfirmDialog.js";
import type { PostsController } from "./hooks/use-posts.hooks.js";

export function PostsTrashConfirm({ pendingDelete, rowSavingId, removePost, setPendingDelete, t }: Pick<PostsController, "pendingDelete" | "rowSavingId" | "removePost" | "setPendingDelete"> & { t: (key: string) => string }, _optional = {}) {
  return (
      <ConfirmDialog
        open={pendingDelete !== null}
        agentHandle="posts-delete"
        title={t("Move to trash?")}
        body={
          pendingDelete ? (
            <p>
              {t("Move")} &quot;{pendingDelete.title}&quot; {t("to trash? It will disappear from the site and from this list.")}
            </p>
          ) : null
        }
        confirmLabel={t("Move to trash")}
        destructive
        pending={pendingDelete !== null && rowSavingId === pendingDelete.id}
        onConfirm={removePost}
        onCancel={() => setPendingDelete(null)}
      />
  );
}
