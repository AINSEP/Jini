const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Explicit unrelated namespaces retain their isolation; omitted names select portable metadata. */
export function isPortableAgentPluginNamespace({ namespace }: { readonly namespace?: string | undefined }, _optional = {}): boolean {
  return namespace === undefined || namespace === 'jini' || namespace === 'tovu';
}

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
  if (!isObject(value) || !isObject(value.extensions)) return 'jini';
  const extensions = value.extensions;
  if (Object.hasOwn(extensions, 'jini')) return 'jini';
  // Compatibility only: existing published manifests used this product's extension key.
  return Object.hasOwn(extensions, 'tovu') ? 'tovu' : 'jini';
}

/** Existing installed copies remain readable through at least this date; removal requires an
 * explicit release decision, never a clock-based refusal to load a plugin. */
export const legacyAgentPluginMetadataWarning = 'Legacy extensions.tovu agent-plugin metadata is deprecated; compatibility is retained through at least 2027-05-06. Portable packages use extensions.jini and unprefixed MCP metadata.';

/** Select an extension without requiring a complete manifest, for preboot metadata readers.
 * @complexity O(1); no I/O or mutation. */
export function readAgentPluginPortableExtension(
  required: { readonly value: unknown },
  optional: { readonly identityNamespace?: string } = {},
): Readonly<Record<string, unknown>> | undefined {
  const namespace = resolveAgentPluginIdentityNamespace(required, optional);
  const value = required.value;
  if (!isObject(value) || !isObject(value.extensions) || !Object.hasOwn(value.extensions, namespace)) return undefined;
  const extension = value.extensions[namespace];
  return isObject(extension) ? extension : undefined;
}

/** Diagnostics are returned to the host so it can choose its normal warning surface. */
export function readAgentPluginCompatibilityWarnings(
  required: { readonly value: unknown },
  optional: { readonly identityNamespace?: string } = {},
): readonly string[] {
  return isPortableAgentPluginNamespace({ namespace: optional.identityNamespace }) && resolveAgentPluginIdentityNamespace(required, optional) === 'tovu'
    ? [legacyAgentPluginMetadataWarning] : [];
}

/** Lifecycle host names identify effects and packaging; portable metadata remains portable.
 * A declared canonical key wins; explicit custom metadata keeps its isolation from legacy keys.
 * A valid legacy object remains the fallback for hosts without their own declaration. */
export function resolveAgentPluginLifecycleNamespace(
  { value, extensionNamespace }: { readonly value: unknown; readonly extensionNamespace: string },
  _optional = {},
): string {
  if (!isObject(value) || !isObject(value.extensions)) return extensionNamespace;
  const extensions = value.extensions;
  if (Object.hasOwn(extensions, 'jini')) return 'jini';
  if (!isPortableAgentPluginNamespace({ namespace: extensionNamespace }) && (Object.hasOwn(extensions, extensionNamespace) || !isObject(extensions.tovu))) return extensionNamespace;
  return Object.hasOwn(extensions, 'tovu') ? 'tovu' : extensionNamespace;
}

/** Translate installed legacy MCP entries without granting read trust from transport data.
 * Portable names take precedence even when malformed, leaving validation to the shared parser.
 * @complexity O(k), bounded by the default-tools declaration. */
export function readCompatibleAgentPluginServerMetadata(
  { value, server }: { readonly value: Readonly<Record<string, unknown>>; readonly server: Readonly<Record<string, unknown>> },
  _optional = {},
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(['authMode', 'defaultTools', 'tokenAuth', 'renamedTools'].map(key => {
    const legacyKey = `tovu${key[0]!.toUpperCase()}${key.slice(1)}`;
    // Legacy adapters treated null aliases as absent; canonical null stays malformed.
    const declared = value[key] !== undefined ? value[key] : value[legacyKey] ?? undefined;
    const inline = server[key] !== undefined ? server[key] : server[legacyKey];
    return [key, declared !== undefined ? declared : inlineMetadata({ key, value: inline })];
  }));
}

/** Whether compatibility aliases were read, for the MCP parser's returned diagnostics. */
export function hasLegacyAgentPluginServerMetadata(
  { value, server }: { readonly value: Readonly<Record<string, unknown>>; readonly server: Readonly<Record<string, unknown>> },
  _optional = {},
): boolean {
  return ['tovuAuthMode', 'tovuDefaultTools', 'tovuTokenAuth', 'tovuRenamedTools'].some(key => Object.hasOwn(value, key) || Object.hasOwn(server, key));
}

/** Transport declarations keep sign-in defaults, but reviewed reads require plugin.json metadata. */
function inlineMetadata({ key, value }: { readonly key: string; readonly value: unknown }): unknown {
  return key === 'defaultTools' && isObject(value)
    ? Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'read')) : value;
}
