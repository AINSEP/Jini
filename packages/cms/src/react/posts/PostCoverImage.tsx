import { useId, type ComponentType } from "react";
import type { AgentHandleOptions, AgentHandleProps } from "@jini-ai/core/agent-handles";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import type { PostFeaturedImageController } from "./hooks/use-post-featured-image.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file The cover image above the post's title node (owner, 2026-10-10: "an image in the tiptap above
 * the title"). Editor chrome, not a TipTap node: it sits in the editor shell just above
 * `.editor-body`, in the same content column, and edits the post's `featuredMediaId`, so `bodyJson`,
 * the title node and public rendering are unchanged. Props and JSX only; the picker state and preview
 * URL come from `use-post-featured-image.hooks.ts`.
 *
 * Since 2026-10-11 (owner) this is the only featured-image control: the settings modal's Image tab
 * (the same picker, Choose/Change/Remove) was removed, and its "Hide the cover image in the body"
 * toggle (`ext["post-presentation"].hideCoverImageInBody`, saved with the post) sits under the slot.
 */

type AgentAttrs = (
  required: { handle: string },
  optional?: AgentHandleOptions,
) => AgentHandleProps;

export interface PostCoverImageBindings {
  Icon: ComponentType<{ name: "image"; size: 16; "aria-hidden": "true" }>;
  InfoTip: ComponentType<{ label: string; descriptionId: string; agentHandle: string }>;
  MediaPickerDialog: ComponentType<{
    onSelect: (item: AdminMedia) => void;
    onCancel: () => void;
    accept: readonly string[];
    agentHandle: string;
  }>;
  agentHandle: AgentAttrs;
  showsCoverImageSlot: (
    required: { bodyFormat: "doc" | "html" | undefined },
    optional?: Record<string, never>,
  ) => boolean;
  showsHideCoverInBodyToggle: (
    required: { kind: "post" | "page" },
    optional?: Record<string, never>,
  ) => boolean;
}

export interface PostCoverImageProps {
  bodyFormat: "doc" | "html" | undefined;
  featuredMediaId: string | null;
  setFeaturedMediaId: (id: string | null) => void;
  kind: "post" | "page";
  hideCoverImageInBody: boolean;
  setHideCoverImageInBody: (value: boolean) => void;
  t: Translate;
  bindings: PostCoverImageBindings;
  /** Injectable seam for the picker state. */
  useFeaturedImage: (required: { value: string | null; onChange: (id: string | null) => void }, optional?: Record<string, never>) => PostFeaturedImageController;
}

export function PostCoverImage({ bodyFormat, featuredMediaId, setFeaturedMediaId, kind, hideCoverImageInBody, setHideCoverImageInBody, t, bindings, useFeaturedImage }: PostCoverImageProps) {
  const { Icon, InfoTip, MediaPickerDialog, agentHandle, showsCoverImageSlot, showsHideCoverInBodyToggle } = bindings;
  const picker = useFeaturedImage({ value: featuredMediaId, onChange: setFeaturedMediaId });
  if (!showsCoverImageSlot({ bodyFormat: bodyFormat })) return null;
  return (
    <div className={picker.previewUrl ? "post-cover post-cover-set" : "post-cover"}>
      {picker.previewUrl ? <PostCoverPreview picker={picker} src={picker.previewUrl} t={t} agentHandle={agentHandle} /> : (
        <button
          type="button"
          className="btn-ghost post-cover-add"
          onClick={picker.openPicker}
          {...agentHandle({ handle: "post-cover-add" }, { role: "button", label: "Add a cover image above the title (the post's featured image) from the media library" })}
        >
          <Icon name="image" size={16} aria-hidden="true" />
          {t("Add cover image")}
        </button>
      )}
      {showsHideCoverInBodyToggle({ kind: kind }) ? <PostCoverBodyToggle checked={hideCoverImageInBody} onChange={setHideCoverImageInBody} t={t} agentHandle={agentHandle} InfoTip={InfoTip} /> : null}
      {picker.pickerOpen ? (
        <MediaPickerDialog onSelect={(item) => picker.handleSelect({ item })} onCancel={picker.closePicker} accept={picker.accept} agentHandle="post-cover-dialog" />
      ) : null}
    </div>
  );
}

/** `src` is the caller's already-checked `picker.previewUrl` (this only renders when one exists),
 *  so the image needs no `previewUrl ?? undefined` fallback for a null it can never see. */
function PostCoverPreview({ picker, src, t, agentHandle }: { picker: PostFeaturedImageController; src: string; t: Translate; agentHandle: AgentAttrs }) {
  return (
    <span className="post-cover-frame">
      {picker.previewFailed ? (
        <span className="post-cover-image post-cover-missing editor-featured-preview-missing" role="img" aria-label={t("Cover image unavailable")} title={t("Cover image unavailable")} />
      ) : (
        <img className="post-cover-image" src={src} alt={t("Cover image")} onError={picker.onPreviewError} />
      )}
      <span className="post-cover-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={picker.openPicker}
          {...agentHandle({ handle: "post-cover-change" }, { role: "button", label: "Replace this post's cover image (its featured image) from the media library" })}
        >
          {t("Change")}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={picker.clear}
          {...agentHandle({ handle: "post-cover-remove" }, { role: "button", label: "Remove this post's cover image (its featured image)" })}
        >
          {t("Remove")}
        </button>
      </span>
    </span>
  );
}

/** The checkbox under the slot. The ⓘ is a sibling of the `<label>`, not inside it, so tapping it
 *  cannot also toggle the checkbox (same layout as `AssistantToggleRow`). */
function PostCoverBodyToggle({ checked, onChange, t, agentHandle, InfoTip }: { checked: boolean; onChange: (value: boolean) => void; t: Translate; agentHandle: AgentAttrs; InfoTip: PostCoverImageBindings["InfoTip"] }) {
  const infoId = useId();
  return (
    <span className="post-cover-option">
      <label>
        <input
          type="checkbox"
          checked={checked}
          aria-describedby={infoId}
          onChange={(event) => onChange(event.target.checked)}
          {...agentHandle({ handle: "post-cover-hide-in-body" }, { role: "checkbox", label: "Hide the post's first body image on the public page when it is already shown as the cover" })}
        />
        {t("Hide the cover image in the body")}
      </label>
      <InfoTip label={t("Applies when the cover comes from the first image in the post")} descriptionId={infoId} agentHandle="post-cover-hide-in-body-info" />
    </span>
  );
}
