/** Site form receiver preference data; the settings ledger owns registration and effective resolution. */
import { ensureSettingDefinitions, getEffective, SCOPE_BIT, type EnsureSettingDefinitionsDeps, type SettingsRepoPort } from "@jini-ai/core/settings";

/** Which receiver takes a static publish's form submissions: `auto` (the co-hosted destination for
 *  the hosting target, the behavior before destinations were their own category), `none`, or a
 *  destination id (`features/form-destinations/select.ts`). */
const NAMESPACE = "core.forms";
const KEY = "receiver";

/** Register the site default without replacing an operator's stored value.
 * @returns Resolves after the existing settings registrar finishes; propagates ledger errors.
 * @complexity O(1), one definition.
 * @example ensureFormDestinationSetting({ deps, systemPrincipalId });
 */
export function ensureFormDestinationSetting(
  { deps, systemPrincipalId }: { deps: EnsureSettingDefinitionsDeps; systemPrincipalId: string },
  _options: Record<string, never> = {},
): Promise<void> {
  return ensureSettingDefinitions(deps, {
    namespace: NAMESPACE, systemPrincipalId,
    definitions: [{ key: KEY, schema: { type: "string" }, defaultValue: "auto", scopes: SCOPE_BIT.workspace }],
  });
}

/** The site's effective receiver value; undefined when unset or not a string (the selector reads that as auto).
 * @throws Propagates ledger failures.
 * @complexity One effective setting read.
 */
export async function readFormDestinationSetting(
  { settingsRepo, workspaceId }: { settingsRepo: SettingsRepoPort; workspaceId: string },
  _options: Record<string, never> = {},
): Promise<string | undefined> {
  const setting = await getEffective({ deps: { repo: settingsRepo }, namespace: NAMESPACE, key: KEY, scopeContext: { workspaceId } });
  return typeof setting?.value === "string" ? setting.value : undefined;
}
