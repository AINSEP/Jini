import type { PostRecord } from "../../posts/post.js";
import type { AdminPostEnvelope } from "@jini-ai/core/contracts/headless/contracts";
import { toHeadlessPost } from "../../public-http/http/shared/post.js";

export function toAdminPostResponse(post: PostRecord): AdminPostEnvelope {
  return {
    post: toHeadlessPost(post),
  };
}
