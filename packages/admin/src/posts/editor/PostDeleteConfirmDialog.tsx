import type { AdminPost } from "../api/posts-api.types.js";
import { ConfirmDialog } from "../../react/components/ConfirmDialog/ConfirmDialog.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { type Translate } from "@jini-ai/core/text";

/**
 * Delete-confirmation presentation, including local discard before first Save. This owner keeps
 * the title, consequence and action label together; a local working copy has no server row to trash.
 * Jini's ConfirmDialog continues to own the dialog lifecycle and confirmation behavior.
 */
export function PostDeleteConfirmDialog({
  kindLabel,
  post,
  open,
  pending,
  onConfirm,
  onCancel,
  t,
}: {
  kindLabel: "post" | "page";
  post: Pick<AdminPost, "id" | "title">;
  open: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  t: Translate;
}) {
  return (
    <ConfirmDialog
      open={open}
      agentHandle="post-delete-confirm"
      title={t(post.id ? "Move to trash?" : "Discard post?")}
      body={post.id ? (
        <p>
          {t(kindLabel === "page" ? "Move this page" : "Move this post")} (&quot;{post.title}&quot;){" "}
          {t(
            kindLabel === "page"
              ? "to trash? It will disappear from the site and from the pages list."
              : "to trash? It will disappear from the site and from the posts list.",
          )}
        </p>
      ) : <p>{t("Discard this unsaved post?")}</p>}
      confirmLabel={t(post.id ? "Move to trash" : "Discard")}
      destructive
      pending={pending}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
