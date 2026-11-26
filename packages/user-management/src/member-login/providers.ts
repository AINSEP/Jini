import type { LoginProvider } from "@jini-ai/core/contracts/site/user-management-server";
import { parseLoginProviders } from "../server/login-providers.js";
import type { LoginProviderPreset } from "../server/login-types.js";

export const LOGIN_PROVIDERS_FILENAME = "jini-login-providers.json";

export function fingerprint({ value, sha256Hex }: { value: LoginProviderPreset; sha256Hex: (required: { text: string }) => string }, _optional = {}): string {
  return sha256Hex({ text: JSON.stringify(value) });
}

/** Read only the product-owned bundle catalog root, never a workspace-installed package root.
 * Manifest namespace and the lifecycle's contained source reader establish the pinned presets.
 * @throws I/O errors for a broken shipped catalog; fails closed rather than trusting installed data.
 * @complexity O(p) bundled packages, two small file reads per provider package.
 */
export async function loadBundledLoginProviders(required: {
  sourceRoot: string;
  sha256Hex: (required: { text: string }) => string;
  bundledContributionSources: (required: { sourceRoot: string; filename: string }) => Iterable<{ pluginId: string; packageRoot: string }>;
  readManifest: (required: { plugin: { pluginId: string; packageRoot: string } }) => Promise<unknown>;
  acceptsManifest: (required: { manifest: unknown; plugin: { pluginId: string; packageRoot: string } }) => boolean;
  loadPluginContributionsFromSource: (required: {
    plugin: { pluginId: string; packageRoot: string };
    definition: {
      filename: string; contribution: string; kind: "data"; parse: typeof parseLoginProviders;
      load: (required: { descriptor: LoginProviderPreset; plugin: { pluginId: string } }) => LoginProvider;
      onReadError: (required: { error: unknown }) => readonly string[] | undefined;
    };
  }) => Promise<{ items: readonly LoginProvider[] }>;
}, _options = {}): Promise<readonly LoginProvider[]> {
  const contribution: Parameters<typeof required.loadPluginContributionsFromSource>[0]["definition"] = {
    filename: LOGIN_PROVIDERS_FILENAME, contribution: "member login providers", kind: "data", parse: parseLoginProviders,
    load: ({ descriptor, plugin }) => ({ ...descriptor, pluginId: plugin.pluginId, configurationVersion: fingerprint({ value: descriptor, sha256Hex: required.sha256Hex }) }),
    onReadError: ({ error }) => (error as { code?: string }).code === "ENOENT" ? [] : undefined,
  };
  const items: LoginProvider[] = [];
  for (const plugin of required.bundledContributionSources({ sourceRoot: required.sourceRoot, filename: LOGIN_PROVIDERS_FILENAME })) {
    const manifest = await required.readManifest({ plugin });
    if (!required.acceptsManifest({ manifest, plugin })) continue;
    const loaded = await required.loadPluginContributionsFromSource({ plugin, definition: contribution });
    items.push(...loaded.items);
  }
  return items;
}


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
