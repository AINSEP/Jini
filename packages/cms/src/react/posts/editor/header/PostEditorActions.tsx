import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { ComponentType } from "react";

/**
 * The status select, save feedback and the publish/save/delete buttons — their own row, below the
 * view/template toolbar rather than in the header (owner request, 2026-09-06: "put the published
 * save and delete buttons under the gray desktop/tablet/mobile row").
 *
 * This is where most of `PostEditorHeader`'s branching went when the controls moved: the
 * message/error spans, the publish button's conditional render, and the save button's className.
 * As a top-level function they are scored in their own scope instead of accumulating onto
 * `PostEditor`'s or the header's.
 *
 * `.editor-action-row` (`styles.css`) is shared with `features/pages/PageEditor.tsx`'s own
 * `PageEditorActions`, but the two components are deliberately NOT merged: this one's copy runs
 * through `t` and every control carries an `agentHandle` tag, and Pages' has neither — a shared
 * component would have to make both optional, which is more machinery than the two small siblings
 * it would replace.
 */
export function PostEditorActions({
  message,
  error,
  status,
  setStatus,
  saving,
  onPublish,
  onSave,
  onDeleteClick,
  onOpenSettings,
  kindLabel,
  t,
  Icon,
}: {
  Icon: ComponentType<{ name: "settings"; size: number; "aria-hidden": "true" }>;
  message: string | null;
  error: string | null;
  status: "draft" | "published";
  setStatus: (value: "draft" | "published") => void;
  /** M4 (2026-09-20) — disables Publish and Save while a request is already in flight, so a
   *  same-tick Save-then-Publish (or a double click) can no longer send two writes against the same
   *  `expectedVersion`. See `PostEditorController.saving`'s own doc. Deliberately not threaded onto
   *  Delete, which already gates on `ConfirmDialog`'s own `pending`. */
  saving: boolean;
  onPublish: () => void;
  onSave: () => void;
  onDeleteClick: () => void;
  /** Opens the post settings modal (author, publish time, featured image). */
  onOpenSettings: () => void;
  kindLabel: "post" | "page";
  t: Translate;
}) {
  return (
    <div
      className="editor-action-row content-action-row"
      {...agentHandle({ handle: "post-actions" }, {
        role: "region",
        label: "Save status, the Draft/Published field, and the Publish, Save and Delete buttons",
      })}
    >
      {/* Owner, 2026-10-10: Save and Delete sit right next to the status field as one tight
          group (5px apart) that stays together and resizes as one on narrow screens; the gear
          for the post settings modal is the only thing on the right. */}
      <div className="content-action-group">
        <PostStatusControl status={status} setStatus={setStatus} t={t} />
        <PostActionButtons status={status} saving={saving} onPublish={onPublish} onSave={onSave} onDeleteClick={onDeleteClick} t={t} />
      </div>
      <PostSaveFeedback message={message} error={error} />
      <button
        type="button"
        className="view-template-btn post-settings-trigger"
        onClick={onOpenSettings}
        aria-label={t(kindLabel === "page" ? "Page settings" : "Post settings")}
        title={t(kindLabel === "page" ? "Page settings" : "Post settings")}
        {...agentHandle({ handle: "post-settings-open" }, {
          role: "button",
          label: "Open the post settings: author and show-author, publish time, and featured image",
        })}
      >
        <Icon name="settings" size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function PostStatusControl({
  status,
  setStatus,
  t,
}: {
  status: "draft" | "published";
  setStatus: (value: "draft" | "published") => void;
  t: Translate;
}) {
  return (
    <select
      value={status}
      aria-label={t("Status")}
      onChange={(e) => setStatus(e.target.value as "draft" | "published")}
      {...agentHandle({ handle: "post-status" }, {
        role: "field",
        label:
          "Whether this post is a draft or published — set with page.select_option, not click. " +
          "Setting to Draft unpublishes it (content is kept, just hidden from the site); this is " +
          "NOT the same as Delete, which moves the whole entry to the trash.",
      })}
    >
      <option value="draft">{t("Draft")}</option>
      <option value="published">{t("Published")}</option>
    </select>
  );
}

function PostActionButtons({
  status,
  saving,
  onPublish,
  onSave,
  onDeleteClick,
  t,
}: {
  status: "draft" | "published";
  /** M4 (2026-09-20) — disables Publish and Save while a request is already in flight, so a
   *  same-tick Save-then-Publish (or a double click) can no longer send two writes against the same
   *  `expectedVersion`. See `PostEditorController.saving`'s own doc. Deliberately not threaded onto
   *  Delete, which already gates on `ConfirmDialog`'s own `pending`. */
  saving: boolean;
  onPublish: () => void;
  onSave: () => void;
  onDeleteClick: () => void;
  t: Translate;
}) {
  return (
    <>
      {/* Publish is the one-click "save this and put it live" shortcut, and only makes sense
          while there is something to publish — once `status` is already "published" (same
          "omit rather than disable" precedent `Posts.tsx`'s `RowMenu` uses for its own
          Publish/Unpublish toggle) it disappears rather than rendering disabled with nothing
          left to do, and plain Save takes over as the primary action. The status select still
          covers the reverse direction (unpublish), unchanged. */}
      {status === "draft" ? (
        <button
          type="button"
          onClick={onPublish}
          disabled={saving}
          {...agentHandle({ handle: "post-publish" }, {
            role: "button",
            label:
              "Publish this post/page immediately — saves the current title, slug and body and " +
              "sets status to Published in one action. Only shown while the post is a draft; once " +
              "published, use Save for further edits.",
          })}
        >
          {t("Publish")}
        </button>
      ) : null}
      <button
        type="button"
        className={status === "draft" ? "btn-secondary" : undefined}
        onClick={onSave}
        disabled={saving}
        {...agentHandle({ handle: "post-save" }, { role: "button", label: "Save this post's title, slug, status and body" })}
      >
        {t("Save")}
      </button>
      <button
        type="button"
        className="btn-danger"
        onClick={onDeleteClick}
        {...agentHandle({ handle: "post-delete" }, {
          role: "button",
          label:
            "Move this post/page to the trash — different from unpublishing (the Draft/Published " +
            "field beside it): the entry disappears from every list and the site. Asks for " +
            "confirmation before deleting.",
        })}
      >
        {t("Delete")}
      </button>
    </>
  );
}

function PostSaveFeedback({ message, error }: { message: string | null; error: string | null }) {
  return (
    <>
      {message ? <span className="save-ok">{message}</span> : null}
      {error ? <span className="save-error">{error}</span> : null}
    </>
  );
}
