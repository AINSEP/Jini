import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** media registration declarations; shared placement rationale lives in the host aggregator. */
export const toolMetadata = {
  "library_list": {
    search: { keywords: "library documents document files markdown txt pdf docx csv json saved uploads earlier chat" },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "library_read": {
    search: { keywords: "library document read open source text markdown txt csv json saved file next page" },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "library_save_attachment": {
    search: { keywords: "library document save attachment attached file persist keep permanent markdown pdf docx generated text content write brand notes private",
      queries: ["Save this generated Markdown document to the private Library.", "Save the BRAND.md text you wrote to the Library."] },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "chat_list_pending_attachments": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "media_promote_chat_attachment": {
    search: {
      keywords: "image images photo attachment attachments attached uploaded chat file files add save promote this the one I sent library gallery",
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // --- media -------------------------------------------------------------------------------
  "media_list_assets": {
    search: {
      keywords: "image images photo photos picture pictures file files upload uploads uploaded library gallery attachment attachments slug slugs",
      queries: [
        "Show me all the images in our media library.",
        "I need the id of an image before I can edit its alt text.",
        "Can you list every uploaded file, including trashed ones?",
        "What media assets do we have and what are their checksums?",
        "Show me our full media library.",
        "How many images do I have in my media library?",
        "How many photos do I have uploaded?",
        "How many files do I have in the media library?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "media_trash_asset": {
    search: {
      keywords: "image images photo delete remove trash file picture attachment delete remove photos photo images image picture pictures get rid",
      queries: [
        "Can you delete this image from the media library?",
        "How do I remove a file I no longer need?",
        "Is there a way to permanently purge a media asset, or just trash it?",
        "I want to soft-delete this photo.",
        "What happens if I try to trash an image that's already trashed?",
      ],
    },
    approval: { class: 'trash', confirmation: 'policy' },
  },
  "media_update_metadata": {
    search: {
      keywords: "image alt text caption description rename file photo metadata video videos autoplay muted loop playsinline poster controls attribute attributes html class classes css lazy loading slug slugs",
      queries: [
        "Can you change the alt text on this image?",
        "How do I update the caption for a media file?",
        "Can I edit the credit line on this photo?",
        "I want to change the title of an uploaded image — can I replace the actual file this way?",
        "How do I fix the metadata on an existing media asset?",
        "Can you make this video autoplay everywhere it's used?",
        "How do I add a CSS class to an image?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "media_upload_asset": {
    search: {
      keywords: "image images photo upload uploads uploading add attach file files picture logo library uplaod",
      queries: [
        "Can you upload this image to the media library?",
        "How do I add a new photo to our site's media?",
        "Can I upload an SVG file? What about a file that's too big?",
        "How do I add a new image from a base64 file?",
        "If I upload the same picture twice, does it create two entries?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "media_view_image": {
    search: {
      keywords: "look at see view open show display inspect describe image images picture pictures photo photos media alt text alt-text caption what does it show contain vision visual",
      queries: [
        "Write alt text for this image.",
        "Can you look at this picture and tell me what it shows?",
        "Describe the photo in the media library.",
        "What is in this image? Suggest a caption.",
        "Open the image and check it before I use it.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "media_view_video": {
    search: {
      keywords: "video videos clip clips movie movies watch see view look describe cat content frames stills screenshot timestamps duration audio attachment attached media library motion movement sequence interval intervals spacing gap gaps every seconds start count sampling sheet sheets grid tiles contact skim overview zoom",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
