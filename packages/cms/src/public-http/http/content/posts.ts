import type { PostRecord } from "../../../posts/post.js";
import type { ContentPostPayload } from "@jini-ai/core/contracts/headless/contracts";
import { toHeadlessContentPost } from "../shared/post.js";

/**
 * Serializes a published post into the public content payload contract.
 */
export function toContentPostResponse(required: {
  post: PostRecord;
  activeThemeId: string;
}): ContentPostPayload {
  return {
    post: toHeadlessContentPost(required.post),
    presentation: {
      activeThemeId: required.activeThemeId,
    },
  };
}
