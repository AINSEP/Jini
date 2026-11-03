/** Selects the portable identity key without changing explicit host isolation.
 * Legacy manifests remain readable only when no namespace was requested and `jini` is absent.
 * A present malformed extension is left to the identity validator rather than bypassed.
 * @returns The namespace to pass to the shared identity and metadata readers.
 * @complexity O(1) time and space; no I/O or manifest mutation.
 */
export function resolveAgentPluginIdentityNamespace(
  { value }: { readonly value: unknown },
  { identityNamespace }: { readonly identityNamespace?: string } = {},
): string {
  if (identityNamespace !== undefined) return identityNamespace;
  if (typeof value !== 'object' || value === null || !('extensions' in value)) return 'jini';
  const extensions = value.extensions;
  if (typeof extensions !== 'object' || extensions === null || Array.isArray(extensions)) return 'jini';
  if (Object.hasOwn(extensions, 'jini')) return 'jini';
  // Compatibility only: existing published manifests used this product's extension key.
  return Object.hasOwn(extensions, 'tovu') ? 'tovu' : 'jini';
}
