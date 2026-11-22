/** Site chart preference data; the settings ledger owns registration and effective resolution. */
import { ensureSettingDefinitions, SCOPE_BIT, type EnsureSettingDefinitionsDeps } from "@jini-ai/core/settings";

/** Register the site default without replacing an operator's stored value.
 * @returns Resolves after the existing settings registrar finishes; propagates ledger errors.
 * @complexity O(1), one definition.
 * @example ensureChartProviderSetting({ deps, systemPrincipalId });
 */
export function ensureChartProviderSetting(
  { deps, systemPrincipalId }: { deps: EnsureSettingDefinitionsDeps; systemPrincipalId: string },
  _options: Record<string, never> = {},
): Promise<void> {
  return ensureSettingDefinitions(deps, {
    namespace: "core.charts", systemPrincipalId,
    definitions: [{ key: "provider", schema: { type: "string" }, defaultValue: "plugin.recharts", scopes: SCOPE_BIT.workspace }],
  });
}
