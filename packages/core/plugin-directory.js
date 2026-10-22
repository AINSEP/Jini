/** Shared publisher identity and live plugin lookup. Source-backed, like persistent-state:
 * hosts can adopt the additive entry without replacing a running server's compiled packages. */
const SEGMENT = '[a-z0-9]+(?:[.-][a-z0-9]+)*';
const ID_PATTERN = new RegExp(`^${SEGMENT}/${SEGMENT}$`);
// Legacy site ids used a looser grammar than portable Agent Plugin names. Preserve those keys
// in unknown/<name>; only explicitly declared publisher ids use the new strict grammar.
const LEGACY_NAME_PATTERN = /^[a-z0-9.-]+$/;
const CAPABILITY_PATTERN = new RegExp(`^${SEGMENT}(?::${SEGMENT})?$`);
const object = value => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A declared id is malformed when it is not a bounded publisher/name string. */
const malformedId = id => typeof id !== 'string' || id.length > 129 || !ID_PATTERN.test(id);
const validCapability = p => typeof p === 'string' && p.length <= 129 && CAPABILITY_PATTERN.test(p);
const legacyIdFor = localName => `unknown/${localName}`;

/** The first shape error that stops identity validation before any field is interpreted. */
function structuralError({ manifest, namespace }) {
  if (!object(manifest)) return 'Plugin manifest must be an object.';
  if (manifest.extensions !== undefined && !object(manifest.extensions)) return 'Plugin extensions must be an object.';
  const extension = manifest.extensions?.[namespace];
  if (extension !== undefined && !object(extension)) return 'Plugin identity extension must be an object.';
  return undefined;
}

/** Errors for a declared id; an absent id is a legacy identity, not an error. */
function idErrors({ id }) {
  if (id === undefined) return [];
  if (malformedId(id)) return ['Plugin id must have the form publisher/name (lowercase letters, digits, dots and hyphens).'];
  // Only the host may infer a legacy identity; a publisher cannot claim its upgrade exemption.
  return id.startsWith('unknown/') ? ["Plugin publisher 'unknown' is reserved for legacy identities."] : [];
}

/** Errors for a declared provides list; one malformed entry rejects the list rather than being dropped. */
function providesErrors({ provides }) {
  const valid = provides === undefined || (Array.isArray(provides) && provides.every(validCapability));
  return valid ? [] : ['Plugin provides must be an array of capability names.'];
}

/** Collects identity errors without mutating the portable manifest. Absent metadata is legacy.
 * @param {{manifest: unknown, namespace: string}} required
 * @param {Record<string, never>} [optional]
 * @returns {{errors: string[]}}
 * @complexity O(k + p) in keyword and provides entries; no I/O.
 */
export function validatePluginIdentity({ manifest, namespace }, optional = {}) {
  const structural = structuralError({ manifest, namespace });
  if (structural !== undefined) return { errors: [structural] };
  const extension = manifest.extensions?.[namespace];
  if (extension === undefined) return { errors: [] };
  return { errors: [...idErrors({ id: extension.id }), ...providesErrors({ provides: extension.provides })] };
}

/** Resolves one identity; warns on missing ids and refuses malformed declarations.
 * @param {{manifest: Record<string, unknown>, namespace: string, name?: string}} required
 * @param {Record<string, never>} [optional]
 * @returns {{id: string, keywords: string[], provides: string[], warnings: string[]}}
 * @throws {TypeError} Malformed identity metadata or missing legacy name.
 * @example readPluginIdentity({ manifest: { name: 'example' }, namespace: 'host' })
 * @complexity O(k + p), copying arrays so a caller cannot mutate manifest metadata.
 */
export function readPluginIdentity({ manifest, namespace, name }, optional = {}) {
  const { errors } = validatePluginIdentity({ manifest, namespace });
  if (errors.length) throw new TypeError(errors.join(' '));
  const extension = manifest.extensions?.[namespace];
  const declaredId = extension?.id;
  const localName = name ?? manifest.name;
  const id = declaredId ?? legacyIdentity({ localName });
  const keywords = normalizeKeywords({ raw: manifest.keywords });
  const warnings = declaredId === undefined ? [`Plugin '${localName}' has no publisher-qualified id; using '${id}'.`] : [];
  return { id, keywords, provides: [...(extension?.provides ?? [])], warnings: [...warnings, ...keywordWarnings({ raw: manifest.keywords, keywords })] };
}

/** The host-inferred `unknown/<name>` id, refusing a name the legacy grammar never accepted. */
function legacyIdentity({ localName }) {
  if (typeof localName !== 'string' || !LEGACY_NAME_PATTERN.test(localName)) {
    throw new TypeError('A valid plugin name is required for a legacy identity.');
  }
  return legacyIdFor(localName);
}

/** Keywords are advisory portable metadata: older manifests accepted mixed or non-array values.
 * The portable parser's coercion (non-string entries dropped, non-arrays ignored) lives here
 * so validation and lookup normalize advisory metadata through the same owner. */
function normalizeKeywords({ raw }) {
  return Array.isArray(raw) ? raw.filter(k => typeof k === 'string' && k.trim().length > 0) : [];
}

/** One warning when normalization ignored any declared keyword (or a non-array value). */
function keywordWarnings({ raw, keywords }) {
  const ignored = raw !== undefined && (!Array.isArray(raw) || keywords.length !== raw.length);
  return ignored ? ['Plugin keywords must be an array of nonempty strings; invalid keywords were ignored.'] : [];
}

/** Rejects id reuse and publisher changes at an existing storage slot. Legacy metadata may
 * acquire its first publisher id during an upgrade; a declared publisher can never be replaced.
 * @param {{candidate: {id: string, family: string, localId: string}, installed: import('./plugin-directory.js').PluginProvider[]}} required
 * @param {Record<string, never>} [optional]
 * @returns {void}
 * @throws {Error} Conflicting publisher identity.
 * @complexity O(n) for n installed providers.
 */
export function assertPluginIdentityAvailable({ candidate, installed }, optional = {}) {
  for (const plugin of installed) {
    const sameSlot = plugin.family === candidate.family && plugin.localId === candidate.localId;
    const conflict = sameSlot ? sameSlotConflict({ plugin, candidate }) : otherSlotConflict({ plugin, candidate });
    if (conflict !== undefined) throw new Error(conflict);
  }
}

/** A provider already in the candidate's slot may only be the same identity or its legacy fallback. */
function sameSlotConflict({ plugin, candidate }) {
  const compatible = plugin.id === candidate.id || plugin.id === legacyIdFor(candidate.localId);
  return compatible ? undefined : `Plugin '${candidate.localId}' belongs to a different publisher identity.`;
}

/** A provider in another slot may not reuse the candidate's id, except equal legacy fallback ids,
 * which are family-scoped and so name distinct plugins in different families. */
function otherSlotConflict({ plugin, candidate }) {
  if (plugin.id !== candidate.id) return undefined;
  const crossFamilyLegacy = plugin.family !== candidate.family && candidate.id === legacyIdFor(candidate.localId) && plugin.id === legacyIdFor(plugin.localId);
  return crossFamilyLegacy ? undefined : `Duplicate plugin id '${candidate.id}'.`;
}

/** Restricts an SDK handle at runtime, not just through a TypeScript interface. A host may carry
 * lifecycle mutation ports, but a plugin's discovery surface exposes only these metadata reads.
 * @param {{lookup: import('./plugin-directory.js').PluginLookupPort}} required
 * @param {Record<string, never>} [optional]
 * @returns {import('./plugin-directory.js').PluginLookupPort}
 * @complexity O(1); delegates live reads without copying host methods.
 */
export function createPluginLookupFacade({ lookup }, optional = {}) {
  return {
    getPlugin: (required, options = {}) => lookup.getPlugin(required, options),
    findProviders: (required, options = {}) => lookup.findProviders(required, options),
  };
}

/** Live, metadata-only directory over injected workspace-scoped sources. No plugin imports.
 * Later duplicate providers are omitted with a warning, preserving the source's incumbent order.
 * Admission checks the unfiltered installs separately, including disabled/cross-family collisions.
 * Legacy fallback ids are family-scoped; an unscoped ambiguous get returns null.
 * @param {{listPlugins: (required: {}, optional?: {}) => Promise<import('./plugin-directory.js').PluginProvider[]>}} required
 * @param {{warn?: (message: string) => void}} [optional]
 * @returns {import('./plugin-directory.js').PluginLookupPort}
 * @example createPluginLookup({ listPlugins: async () => [] })
 * @complexity O(n log n) per lookup, n installed plugins. Fresh reads preserve revocation.
 */
export function createPluginLookup({ listPlugins }, optional = {}) {
  const warn = optional.warn ?? console.warn;
  async function snapshot() {
    const plugins = await listPlugins({}, {});
    const seen = new Set();
    const unique = [];
    for (const plugin of plugins) {
      const key = plugin.id === `unknown/${plugin.localId}` ? `${plugin.family}:${plugin.id}` : plugin.id;
      if (seen.has(key)) {
        warn(`Duplicate plugin id '${plugin.id}'; later provider omitted from metadata lookup.`);
        continue;
      }
      seen.add(key);
      unique.push(plugin);
    }
    // Project metadata explicitly: host paths, services and additional source properties never
    // leave this boundary, and a consumer cannot mutate the source's discovery arrays.
    return unique.map(plugin => ({
      id: plugin.id, version: plugin.version, enabled: plugin.enabled, family: plugin.family,
      localId: plugin.localId, keywords: [...plugin.keywords], provides: [...plugin.provides],
    })).sort((a, b) => a.id.localeCompare(b.id));
  }
  return {
    async getPlugin({ id, family }, options = {}) {
      const matches = (await snapshot()).filter(plugin => plugin.id === id && (family === undefined || plugin.family === family));
      return matches.length === 1 ? matches[0] : null;
    },
    async findProviders({ capability }, { enabledOnly = false } = {}) {
      return (await snapshot()).filter(plugin => (!enabledOnly || plugin.enabled) && plugin.provides.includes(capability));
    },
  };
}
