import type { ClientNamespaceFor } from "@jini-ai/core/contracts/site/integrations-api-connections";

/**
 * @file The client-setting prefix each BUNDLED plugin's own `plugin.json` declares
 * (`extensions.jini.clientNamespace`). Vendor names live in those manifests, never in host code.
 * Only bundled manifests are read: an installed plugin cannot choose a prefix, so it keeps the host's.
 */

/**
 * Builds the resolver the API-connection loader asks, one plugin at a time.
 * @param required.pluginIds Ids of the bundled plugins; any other id resolves to `undefined`.
 * @param required.readManifest Returns the parsed `plugin.json` of a bundled plugin, or `null` when it cannot be read.
 * @param required.readClientNamespace Projects a parsed manifest to its declared client-setting prefix, or `undefined` when it declares none (or a malformed one).
 * @returns A resolver; a missing, unreadable or invalid declaration resolves to `undefined` (the host's own prefix applies).
 * @complexity O(1) per call, one manifest read.
 */
export function createBundledClientNamespaceReader(
  required: {
    readonly pluginIds: ReadonlySet<string>;
    readonly readManifest: (input: { readonly pluginId: string }) => unknown;
    readonly readClientNamespace: (required: {
      readonly value: unknown;
    }) => string | undefined;
  },
  _optional: Record<string, never> = {},
): ClientNamespaceFor {
  return async ({ pluginId }) => {
    if (!required.pluginIds.has(pluginId)) return undefined;
    const manifest = required.readManifest({ pluginId });
    return manifest === null ? undefined : required.readClientNamespace({ value: manifest });
  };
}
