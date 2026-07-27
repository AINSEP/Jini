/**
 * @module @jini/agentic/capability
 *
 * The vocabulary every agent-drivable surface shares: what an outside caller may ask a
 * frontend to do, described as pure data with no transport, DOM, or framework attached.
 *
 * One noun, deliberately: **capability**. The chat pane's first draft used `tool` in its
 * type names and `capability` in its ids, which forked the vocabulary across four files.
 * `tool` stays reserved for the engine's own `ToolRegistry`/`ToolExecutor` nouns; anything
 * an outside caller asks a *frontend* to do is a capability. Transports may of course
 * present capabilities as MCP tools — that is a projection, not a rename.
 */

/** How much damage a capability can do. `requiresConfirmation` is the enforcement; this is the label. */
export type CapabilityRisk = 'read' | 'write';

/**
 * Whether a capability means anything without a live UI session attached.
 *
 * - `session` — needs a connected frontend. "Highlight this field" is meaningless with no
 *   tab open, and must fail closed with a distinct error rather than hanging on a timeout.
 * - `server` — a product outcome the backend can satisfy headlessly. Sending a chat message
 *   is the same outcome whether a tab is open or not.
 *
 * This decides *availability*, so a caller can be told "no eligible frontend is connected"
 * instead of waiting for a timeout that will never resolve.
 */
export type CapabilitySurface = 'session' | 'server';

export interface CapabilityInputSchema {
  readonly type: 'object';
  readonly properties: Record<string, { type: string; description?: string; enum?: readonly string[] }>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface CapabilityDef {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: CapabilityInputSchema;
  readonly risk: CapabilityRisk;
  readonly surface: CapabilitySurface;
  /**
   * Destructive or otherwise irreversible — the caller must acknowledge before it runs. A host
   * with a real confirmation gate (`@jini/daemon`'s `ToolExecutor` has a resumable one) should
   * enforce it there; surfaces without one enforce it in-band by requiring `confirm: true`, so
   * no transport can execute it by accident.
   */
  readonly requiresConfirmation?: boolean;
}

/**
 * Looks a capability up by id.
 *
 * @param capabilities - The manifest to search.
 * @param id - Capability id to resolve.
 * @returns The definition, or `undefined` when the id is not in the manifest.
 */
export function findCapability(
  capabilities: readonly CapabilityDef[],
  id: string,
): CapabilityDef | undefined {
  return capabilities.find((capability) => capability.id === id);
}

/**
 * Checks caller input against a capability's declared schema.
 *
 * Manifests advertise `additionalProperties: false` and a `required` list, but nothing was
 * enforcing either — handlers read the fields they knew about and ignored the rest, so a
 * misnamed argument silently became a missing one. This closes that for any surface that calls
 * it. Intentionally a shallow check, not a JSON Schema engine: these schemas are flat by
 * construction, and a real validator is a dependency this package will not take.
 *
 * @param capability - The capability being invoked.
 * @param input - Raw caller-supplied arguments.
 * @returns An error message, or `null` when the input is acceptable.
 */
export function findCapabilityInputError(
  capability: CapabilityDef,
  input: Record<string, unknown>,
): string | null {
  const { properties, required, additionalProperties } = capability.inputSchema;

  for (const name of required ?? []) {
    if (input[name] === undefined) return `"${name}" is required`;
  }

  if (additionalProperties === false) {
    // `key in properties` walks the whole prototype chain, so a key that happens to be inherited
    // from Object.prototype (`__proto__`, `constructor`, `toString`, `valueOf`, …) reads as
    // "known" regardless of whether the schema actually lists it — `'constructor' in {}` is
    // true even on an empty object. `JSON.parse('{"__proto__":...}')` creates a real own data
    // property (not the accessor), so this was a live way for such a key to escape the
    // "unknown argument" refusal entirely. hasOwnProperty ignores the prototype chain, so only
    // keys the schema actually declares count as known.
    const unknown = Object.keys(input)
      .filter((key) => !Object.prototype.hasOwnProperty.call(properties, key));
    if (unknown.length > 0) {
      return `unknown ${unknown.length === 1 ? 'argument' : 'arguments'}: ${unknown.sort().join(', ')}`;
    }
  }

  for (const [name, schema] of Object.entries(properties)) {
    const value = input[name];
    if (value === undefined) continue;
    const actual = Array.isArray(value) ? 'array' : typeof value;
    if (actual !== schema.type) return `"${name}" must be a ${schema.type}, received ${actual}`;
    if (schema.enum !== undefined && !schema.enum.includes(value as string)) {
      return `"${name}" must be one of: ${schema.enum.join(', ')}`;
    }
  }

  return null;
}

/**
 * The capabilities a caller may use given what is currently connected.
 *
 * @param capabilities - The full manifest.
 * @param hasSession - Whether a live frontend session is attached.
 * @returns Only the capabilities that can actually be satisfied right now.
 */
export function availableCapabilities(
  capabilities: readonly CapabilityDef[],
  hasSession: boolean,
): readonly CapabilityDef[] {
  return hasSession ? capabilities : capabilities.filter((c) => c.surface === 'server');
}
