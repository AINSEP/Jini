import type { NavLocationBindingRepoPort } from "./ports.js";
import type { MenuRepoPort } from "./index.js";

/** @file The `menu` slice of a publish bag (`PublishPorts`, `@jini-ai/core/contracts/site/publish-ports`). */
export interface MenuPublishPorts {
  readonly repo: MenuRepoPort;
  readonly bindingRepo: NavLocationBindingRepoPort;
}
