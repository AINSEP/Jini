import type { AdminSiteKeyStatus } from "@jini-ai/core/contracts/site/site-key";

import { type Translate } from '@jini-ai/core/text';
/** Keep environment provenance in the status rules so rendering has no source policy. */
export function siteKeyStatusBadgeLabel(
  input: {
    status: Pick<AdminSiteKeyStatus, "active" | "source" | "envVarName">;
    t: Translate;
    fallbackEnvVarName: string;
  },
  _optional = {},
): string {
  const { status, t, fallbackEnvVarName } = input;
  if (!status.active) return t("None");
  if (status.source !== "env") return t("Active — key file");
  return t("Active: environment variable {name}").replace("{name}", () => status.envVarName ?? fallbackEnvVarName);
}
