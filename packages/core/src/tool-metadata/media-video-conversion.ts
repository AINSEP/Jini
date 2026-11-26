import type { ToolMetadataById } from '@jini-ai/core';
import type { ToolApprovalPolicy } from '@jini-ai/core/contracts/site/tool-metadata-approval-policy';

/** `media_convert_video`'s declaration; Jini owns the tool, this host owns its search words. Title,
 * button verb, summary and approval repeat what Jini's tool definition declares, so the card the owner
 * sees is unchanged; shared placement rationale is in ./index.ts. */
export const toolMetadata = {
  "media_convert_video": {
    title: 'Convert video for web',
    actionVerb: 'Convert',
    summary: 'Creates a web-playable MP4 copy of this video. The original stays as it is.',
    search: {
      keywords: "video videos convert conversion transcode mov quicktime iphone hevc h265 mp4 h264 web safe browser chrome play playing plays playback compress smaller",
      queries: [
        "This iPhone .mov video will not play on the site. Can you convert it?",
        "Make a version of this video that plays in every browser.",
        "Can you turn this QuickTime movie into an MP4?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
