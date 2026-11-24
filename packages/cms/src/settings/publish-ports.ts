import type { SettingsRepoPort } from "@jini-ai/core/settings";
import type { PrincipalRepoPort } from "@jini-ai/core/contracts/site/user-management";

/**
 * @file The `site-setting` slice of a publish bag (`PublishPorts`, `@jini-ai/core/contracts/site/publish-ports`).
 *
 * `set` needs `principals` in its deps; a workspace-scope write never reads it.
 */
export interface SettingPublishPorts {
  readonly settings: SettingsRepoPort;
  readonly principals: PrincipalRepoPort;
}
