import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** image-transform registration declarations; shared placement rationale lives in the host aggregator. */
export const toolMetadata = {
  // Theme/media writes are undoable edits; the handler's own card asks for arbitrary site/picked-folder batches,
  // so 'policy' (exchange-only card answers) with an 'edit' class that never adds a second card.
  "image_transform": {
    search: {
      keywords: "image picture photo logo icon favicon ico resize scale crop rotate flip convert webp avif png jpeg thumbnail social og 1200x630 apple-touch sizes compress optimize",
      queries: [
        "Make a favicon set from the site logo.",
        "Resize this image to 1200x630 for social sharing.",
        "Convert these images to webp.",
        "Create thumbnails of a photo.",
      ],
    },
    approval: { class: 'edit', confirmation: 'policy' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
