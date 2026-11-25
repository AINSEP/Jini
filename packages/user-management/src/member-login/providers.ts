import type { LoginProvider } from "@jini-ai/core/contracts/site/user-management-server";

/** Reload activation/digest admission on start AND callback; compare the entire preset with the
 * shipped one. A trusted-looking installed id alone must never select an issuer or JWKS URL.
 * @returns Unique admitted providers only; duplicated ids are refused in full.
 * @complexity O(p + b), installed and bundled provider counts; no per-member queries.
 */
export async function loadLoginProviders(required: {
  workspaceId: string; bundledProviders: readonly LoginProvider[];
  loadCandidates: (required: { workspaceId: string; trustedPluginIds: ReadonlySet<string> }, optional?: Record<string, never>) => Promise<readonly LoginProvider[]>;
}, _optional: Record<string, never> = {}): Promise<readonly LoginProvider[]> {
  const pins = new Map(required.bundledProviders.map(provider => [`${provider.pluginId}:${provider.id}`, provider]));
  const pluginIds = new Set(required.bundledProviders.map(provider => provider.pluginId));
  const loaded = await required.loadCandidates({ workspaceId: required.workspaceId, trustedPluginIds: pluginIds });
  const admitted = loaded.filter(provider => pins.get(`${provider.pluginId}:${provider.id}`)?.configurationVersion === provider.configurationVersion);
  const counts = new Map<string, number>();
  for (const provider of admitted) counts.set(provider.id, (counts.get(provider.id) ?? 0) + 1);
  return admitted.filter(provider => counts.get(provider.id) === 1);
}
