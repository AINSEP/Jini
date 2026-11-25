import type { ArtifactStorePort, DeployTargetCredential } from "@jini-ai/core/contracts/site/devops-deploy";


import type { LoadedObjectStoreRegistry } from "./registry.js";


/**
 * @file Which object-store provider delivers backup shares: any registered provider that can also
 * hand out a single-object artifact store (for example an S3-compatible store), instead of one
 * hard-coded deploy target id. The site's media choice wins when it qualifies, so media and shares
 * use one provider (and one saved connection); otherwise the first qualifying one in registry order.
 * A provider qualifies only once its saved connection resolves and passes its optional artifact
 * credential check, so an installed but unconnected
 * store never hides a connected one behind it. Revoke names the share's saved provider and resolves
 * only that one, so a store connected later can never take over (or block) another store's delete.
 */

/** A provider's artifact capability as the share path calls it (the deploy-target module ABI). */
export interface ArtifactStoreCapable {
  /** Optional provider-owned readiness check for artifact-specific companion credentials. */
  acceptsArtifactCredential?(required: { readonly credential: unknown }, optional?: Record<string, never>): boolean;
  createArtifactStore(required: { readonly credential: DeployTargetCredential; readonly config: Record<string, never>; readonly kit: unknown }): ArtifactStorePort & {
    /** Non-secret identity of the backing store, when the provider knows it better than the host does. */
    readonly binding?: string;
  };
}

/**
 * @param required.resolveCredential The provider's saved connection, or `undefined` when it has none.
 * @param optional.savedProvider A share's recorded provider (its hyphenated connection id): only that
 *   provider is considered.
 * @returns The first capable provider (preferred first, then registry order) whose connection
 *   resolves and passes the provider's artifact check, with that credential; `undefined` when none qualifies.
 * @complexity O(n) registered providers, one credential lookup per capable provider until a hit.
 */
export async function selectArtifactStoreProvider<C, Host>(
  required: { readonly loaded: LoadedObjectStoreRegistry<Host>; readonly preferredId: string; readonly resolveCredential: (required: { readonly id: string }, optional?: Record<string, never>) => Promise<C | undefined> },
  optional: { readonly savedProvider?: string } = {}
): Promise<{ readonly id: string; readonly provider: ArtifactStoreCapable; readonly credential: C } | undefined> {
  const capable = required.loaded.registry.list().filter((entry) => typeof (entry.provider as Partial<ArtifactStoreCapable>).createArtifactStore === "function"
    && (optional.savedProvider === undefined || artifactStoreTarget({ id: entry.id }) === optional.savedProvider));
  const ordered = [...capable.filter((entry) => entry.id === required.preferredId), ...capable.filter((entry) => entry.id !== required.preferredId)];
  for (const entry of ordered) {
    const credential = await required.resolveCredential({ id: entry.id });
    if (credential === undefined) continue;
    const provider = entry.provider as unknown as ArtifactStoreCapable;
    if (provider.acceptsArtifactCredential?.({ credential }) !== false) return { id: entry.id, provider, credential };
  }
  return undefined;
}

/** Provider ids use underscores; the saved connection (and a share's recorded provider) is the hyphenated target id. */
export function artifactStoreTarget({ id }: { id: string }, _optional: Record<string, never> = {}): string {
  return id.replace(/_/g, "-");
}

/**
 * What revoke must match before deleting: a new default connection must never turn revocation into
 * deletion in another bucket. Non-secret storage coordinates bind, so credentials may rotate for the
 * same store; a provider that names its own store (e.g. a token-scoped one) supplies that instead.
 * @complexity O(1).
 */
export function artifactStoreBinding(required: { readonly store: { readonly binding?: string }; readonly credential: Readonly<Record<string, unknown>> }, _optional: Record<string, never> = {}): string {
  const { store, credential } = required;
  return store.binding ?? JSON.stringify([credential.bucket, credential.region, credential.endpoint ?? "", credential.publicUrl]);
}
