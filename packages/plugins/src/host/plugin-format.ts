/** Plugin wire identifiers. Readers prefer the canonical manifest; publishers emit only it. */
export const PLUGIN_MANIFEST_FILENAME = 'jini.plugin.json';
export const PLUGIN_SDK_SPECIFIER = '@jini-ai/plugin-sdk';

export interface PluginManifestReadOptions {
  readonly legacyManifestFilenames?: readonly string[] | undefined;
}

export function pluginManifestFilenames(
  _required: Record<string, never>,
  optional: PluginManifestReadOptions = {},
): readonly string[] {
  return [...new Set([PLUGIN_MANIFEST_FILENAME, ...(optional.legacyManifestFilenames ?? []).filter(name => /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.plugin\.json$/.test(name) && !name.includes('..'))])];
}

/** Preserve the selected manifest's exact bytes while dropping alternate manifest filenames.
 * Missing manifests remain missing so the existing validator owns the diagnostic.
 */
export function canonicalizePluginManifest<T>(
  required: { files: ReadonlyMap<string, T> },
  optional: PluginManifestReadOptions = {},
): Map<string, T> {
  const files = new Map(required.files);
  const filenames = pluginManifestFilenames({}, optional);
  const selected = filenames.map(name => [...files].find(([key]) => key === name)).find(entry => entry !== undefined);
  for (const name of filenames) files.delete(name);
  if (selected !== undefined) files.set(PLUGIN_MANIFEST_FILENAME, selected[1]);
  return files;
}

/** The owner id the claim system gives the host core (`plugin-claims.ts` re-exports it). Conflict
 * detection never compares an owner with itself, so a plugin with this id would never conflict with
 * core's reserved routes, tools or permissions — it is refused as an id instead. */
export const CORE_OWNER_ID = "core";
