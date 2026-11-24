import type { ContentTypeListPort } from "./list.js";
import type { ContentTypeRepoPort, IndexProvisionerPort } from "./write-service.js";

/** @file The `content-type` slice of a publish bag (`PublishPorts`, `@jini-ai/core/contracts/site/publish-ports`). */
export interface ContentTypePublishPorts {
  readonly repo: ContentTypeRepoPort & ContentTypeListPort;
  readonly indexProvisioner: IndexProvisionerPort;
}
