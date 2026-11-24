import type { ForgetRemovedPostFn } from "../widgets/host-ports.js";
import type { PostRepoPort } from "./post.js";

/**
 * @file The `post` slice of a publish bag (`PublishPorts`, `@jini-ai/core/contracts/site/publish-ports`):
 * what the post/page publish handler needs from its host. A host whose trash/remove primitive is its
 * own (`RemovePostFn` — it indexes the item for its Trash screen) intersects that field onto this slice.
 */
export interface PostPublishPorts {
  readonly repo: PostRepoPort;
  /** Apply-only — `apply()`'s rollback path (drops the Trash index row when the write it undoes
   *  was a trash). Never read by `pack`/`inspect`/`precheck`. */
  readonly forgetRemoved?: ForgetRemovedPostFn;
}
