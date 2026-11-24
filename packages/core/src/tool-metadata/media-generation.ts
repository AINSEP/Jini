import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** media-generation registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  "media_generate_asset": {
    search: {
      keywords: "image images generate generated generating create created ai art artwork draw drawing design logo banner illustration picture dall-e dalle openai gpt make making",
      queries: [
        "Can you generate an image of a red bicycle for me?",
        "I need a logo — can you create one with AI?",
        "Generate a hero banner image for the homepage.",
        "Draw me an illustration of a mountain landscape.",
        "Can you make an AI image and add it to the media library?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "media_list_providers": {
    search: {
      keywords: "image generation provider video generation which ai image provider configured set up api key openai replicate available list providers images videos",
      queries: [
        "Which image and video generation providers have a saved connection?",
        "Can you list the AI media vendors this site knows about?",
        "Is an OpenAI image provider credential configured?",
        "Which image providers still need their API key?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
