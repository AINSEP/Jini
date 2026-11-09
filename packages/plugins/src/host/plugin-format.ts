/** Plugin wire identifiers. Readers prefer the canonical manifest; publishers emit only it. */
export const PLUGIN_MANIFEST_FILENAME = 'jini.plugin.json';
export const LEGACY_PLUGIN_MANIFEST_FILENAME = 'tovu.plugin.json'; // legacy alias
export const PLUGIN_MANIFEST_FILENAMES: readonly string[] = [PLUGIN_MANIFEST_FILENAME, LEGACY_PLUGIN_MANIFEST_FILENAME]; // legacy alias
export const PLUGIN_SDK_SPECIFIER = '@jini-ai/plugin-sdk';
export const LEGACY_PLUGIN_SDK_SPECIFIER = '@tovu/sdk'; // legacy alias
export const PLUGIN_SDK_SPECIFIERS: readonly string[] = [PLUGIN_SDK_SPECIFIER, LEGACY_PLUGIN_SDK_SPECIFIER]; // legacy alias

/** Preserve the selected manifest's exact bytes while dropping alternate manifest filenames.
 * Missing manifests remain missing so the existing validator owns the diagnostic.
 */
export function canonicalizePluginManifest<T>(
  required: { files: ReadonlyMap<string, T> },
  _optional: Record<string, never> = {},
): Map<string, T> {
  const files = new Map(required.files);
  const selected = PLUGIN_MANIFEST_FILENAMES.find(name => files.has(name)); // legacy alias
  const manifest = selected === undefined ? undefined : files.get(selected)!;
  for (const name of PLUGIN_MANIFEST_FILENAMES) files.delete(name); // legacy alias
  if (selected !== undefined) files.set(PLUGIN_MANIFEST_FILENAME, manifest!);
  return files;
}

/** The owner id the claim system gives the host core (`plugin-claims.ts` re-exports it). Conflict
 * detection never compares an owner with itself, so a plugin with this id would never conflict with
 * core's reserved routes, tools or permissions — it is refused as an id instead. */
export const CORE_OWNER_ID = "core";
