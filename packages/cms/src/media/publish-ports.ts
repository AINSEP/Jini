import type { MediaContentTypeStorePort } from "./site/content-type-store.js";
import type { AssetBlobRepoPort, BlobStorePort } from "./ports.js";
import type { VersionedMediaRepoPort } from "./versioned-repo.js";

/** @file The `media` slice of a publish bag (`PublishPorts`, `@jini-ai/core/contracts/site/publish-ports`). */
export interface MediaPublishPorts {
  readonly repo: VersionedMediaRepoPort;
  readonly assetBlobRepo: AssetBlobRepoPort;
  readonly blobStore: BlobStorePort;
  /** Where an imported blob's sniffed type is recorded — what the embed resolver reads to render a
   *  video as `<video>` rather than an image. */
  readonly contentTypeStore: MediaContentTypeStorePort;
}
