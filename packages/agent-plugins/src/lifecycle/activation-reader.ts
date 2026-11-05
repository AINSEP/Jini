/** Revision-checked, per-plugin activation queries: no repeated whole-file read on tool calls. */
export interface PluginActivationReaderPorts {
  /** An atomic-file identity/version, not a TTL or wall clock. Errors must reject. */
  revision(required: Record<string, never>, optional?: Record<string, never>): Promise<string>;
  /** The existing strict activation owner; hosts pass only installed provisioning plugin ids. */
  resolve(required: { pluginId: string }, optional?: Record<string, never>): Promise<boolean>;
}

/** Cache one activation bit per plugin only while the host's durable revision remains unchanged.
 * @returns A point-query reader and explicit reset; no global state or timers.
 * @throws The injected revision/resolution error so a security caller can fail closed.
 * @complexity O(1) lookup, one revision check per call; one resolution plus a second revision
 * check on cache miss. O(p) memory for queried installed plugins, cleared on a version change.
 */
export function createVersionedPluginActivationReader({ ports }: { ports: PluginActivationReaderPorts }, _options = {}) {
  let version: string | undefined;
  const enabledById = new Map<string, boolean>();
  async function isEnabled({ pluginId }: { pluginId: string }, _options = {}): Promise<boolean> {
    const current = await ports.revision({}, {});
    if (current !== version) { enabledById.clear(); version = current; }
    if (enabledById.has(pluginId)) return enabledById.get(pluginId)!;
    const enabled = await ports.resolve({ pluginId }, {});
    // A concurrent write must not cache a decision read from the revision it just replaced.
    if (current !== await ports.revision({}, {})) return false;
    enabledById.set(pluginId, enabled);
    return enabled;
  }
  return { isEnabled, clear: (_required: Record<string, never>, _options = {}) => { version = undefined; enabledById.clear(); } };
}
