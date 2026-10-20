/**
 * @file The one check every plugin-written settings value passes before a host stores it: plugin
 * state (`./surface-capabilities.ts`) and a delivery binding's config (`./delivery-bindings.ts`).
 *
 * Why it is shared: both are plugin-chosen JSON the host persists and later hands back (to the
 * plugin's tools, or to the delivery adapter), so both need the same guarantees — plain JSON only,
 * bounded depth and size, and never a token the plugin obtained — and must not drift apart.
 */
import { PLUGIN_STATE_MAX_KEY_LENGTH, type AgentPluginCapabilityGate, type AgentPluginStateValue } from '../lifecycle/tools/capabilities.js';

export const ADMIN_SURFACE_STATE_LIMITS = Object.freeze({ maxKeyLength: PLUGIN_STATE_MAX_KEY_LENGTH, maxValueBytes: 16 * 1024, maxDepth: 16 });
export const STATE_CREDENTIAL_MESSAGE = 'The plugin tried to save a connection credential in its settings; nothing was saved.';

function isStateScalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/** True for plain JSON data only: no undefined, functions, NaN, class instances or deep nesting. @complexity O(n) nodes. */
function isStateValue(value: unknown, depth: number): boolean {
  if (isStateScalar(value)) return true;
  if (typeof value !== 'object' || depth >= ADMIN_SURFACE_STATE_LIMITS.maxDepth) return false;
  if (Array.isArray(value)) return value.every((item) => isStateValue(item, depth + 1));
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Object.values(value as object).every((item) => isStateValue(item, depth + 1));
}

/**
 * The value the host stores: serialized once, scanned and size-checked on that text, then parsed
 * back, so what is stored is exactly what was checked (the plugin cannot change it afterwards).
 * @param required.gate - The call's capability gate (its token memory drives the scan).
 * @param required.value - The plugin's value, unchecked.
 * @throws Error when the value is not plain JSON, is too large, or mentions an obtained token.
 * @complexity O(n) in the serialized size.
 */
export function storedStateValue(required: { readonly gate: AgentPluginCapabilityGate; readonly value: unknown }, _optional: Record<string, never> = {}): AgentPluginStateValue {
  const { gate, value } = required;
  if (!isStateValue(value, 0)) throw new Error('A settings value must be plain JSON data (no undefined, functions, NaN or class instances).');
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > ADMIN_SURFACE_STATE_LIMITS.maxValueBytes) throw new Error(`A settings value may be at most ${ADMIN_SURFACE_STATE_LIMITS.maxValueBytes} bytes of JSON.`);
  if (gate.mentionsToken({ value: text })) throw new Error(STATE_CREDENTIAL_MESSAGE);
  return JSON.parse(text) as AgentPluginStateValue;
}
