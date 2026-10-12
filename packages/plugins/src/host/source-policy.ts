import type { PluginManifest } from "./manifest.js";

/** Host-injected deployment policy. Environment interpretation belongs to composition adapters. */
export interface PluginSourcePolicyPort {
  localInstallEnabled(required?: Record<string, never>, optional?: Record<string, never>): boolean;
  /** `added` is what this version declares beyond the owner's last approval (see `addedPluginCapabilities`). */
  confirmEnable(required: { sealedHere: boolean; added: readonly string[] }, optional?: Record<string, never>): boolean;
}

/** Local authoring runs directly; hosted sideloading retains the host's explicit opt-in.
 * Enabling asks the owner unless the package was sealed on this site AND adds nothing beyond the
 * owner's last approval. Tier-3 code runs in-process with full server authority, so "sealed here"
 * (possibly by the assistant itself) is never consent on its own (owner, 2026-10-12).
 * @param required Deployment facts supplied by the host.
 * @param _optional Reserved factory options.
 * @returns The shared install/enable policy, with no environment reads.
 * @example createPluginSourcePolicy({ hosted: false, localInstallOptIn: false }, {})
 */
export function createPluginSourcePolicy(required: { hosted: boolean; localInstallOptIn: boolean }, _optional = {}): PluginSourcePolicyPort {
  return {
    localInstallEnabled: (_required = {}, _optional = {}) => !required.hosted || required.localInstallOptIn,
    confirmEnable: ({ sealedHere, added }, _optional = {}) => !sealedHere || added.length > 0,
  };
}

/** Everything a manifest lets the plugin reach, as stable `kind:name` entries. Code may change
 * freely between versions without re-asking; only a new entry here is a widening. The tier is an
 * entry so a tier-1 package that becomes tier-3 (code execution) counts as widened.
 * @complexity O(n log n) in the number of declared entries.
 */
export function pluginCapabilitySet({ manifest }: { manifest: Pick<PluginManifest, "tier" | "capabilities" | "hooks" | "fields" | "contentTypes" | "contributes"> }, _optional = {}): readonly string[] {
  const contributes = manifest.contributes ?? {};
  const contentTypeName = (entry: unknown) => typeof (entry as { key?: unknown } | null)?.key === "string" ? (entry as { key: string }).key : JSON.stringify(entry);
  return [...new Set([
    `tier:${manifest.tier}`,
    ...manifest.capabilities.map(name => `capability:${name}`),
    ...manifest.hooks.map(name => `hook:${name}`),
    ...manifest.fields.map(field => `field:${field.path}`),
    ...(manifest.contentTypes ?? []).map(entry => `content-type:${contentTypeName(entry)}`),
    ...(["routes", "tools", "tables", "settings", "widgets", "permissions"] as const)
      .flatMap(kind => (contributes[kind] ?? []).map(name => `${kind.slice(0, -1)}:${name}`)),
  ])].sort();
}

/** Entries of `next` absent from `approved`; with no approval on record, all of `next`.
 * @complexity O(n + m). */
export function addedPluginCapabilities({ approved, next }: { approved: readonly string[] | undefined; next: readonly string[] }, _optional = {}): readonly string[] {
  if (approved === undefined) return next;
  const known = new Set(approved);
  return next.filter(entry => !known.has(entry));
}
