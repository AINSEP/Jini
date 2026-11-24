import type { FormDefinitionRepoPort } from "./ports.js";

/** @file The `form` slice of a publish bag (`PublishPorts`, `@jini-ai/core/contracts/site/publish-ports`). */
export interface FormPublishPorts {
  readonly repo: FormDefinitionRepoPort;
}
