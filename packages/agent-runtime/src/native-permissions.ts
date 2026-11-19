/** Generic native-capability snapshots. Hosts own grant gates, persistence and migration. */
export interface NativeAgentPermissions<K extends string> {
  enabled?: boolean;
  capabilities?: Partial<Record<K, boolean>>;
}

export interface NativePermissionSet<K extends string> {
  enabled: boolean;
  capabilities: Record<K, boolean>;
  byAgent?: Record<string, NativeAgentPermissions<K>>;
}

/** A malformed permission snapshot; the host supplies the safe refusal text. */
export class InvalidNativePermissionsError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = 'InvalidNativePermissionsError';
  }
}

/** The master supplies every default; explicit capability choices remain independent.
 * Returns a fresh snapshot, including independent copies of per-agent choices, without effects.
 * @complexity O(k + a + p) time/space for k keys, a agents and p per-agent capability entries.
 */
export function fillNativePermissions<K extends string>(required: {
  capabilityKeys: readonly K[]; enabled: boolean; capabilities?: Partial<Record<K, boolean>>;
  byAgent?: Record<string, NativeAgentPermissions<K>>;
}, _optional: Record<string, never> = {}): NativePermissionSet<K> {
  const { capabilityKeys, enabled, capabilities, byAgent } = required;
  return {
    enabled,
    capabilities: Object.fromEntries(capabilityKeys.map(key => [key, capabilities?.[key] ?? enabled])) as Record<K, boolean>,
    ...(byAgent ? { byAgent: copyAgentPermissions({ byAgent }) } : {}),
  };
}

function copyAgentPermissions<K extends string>({ byAgent }: {
  byAgent: Record<string, NativeAgentPermissions<K>>;
}): Record<string, NativeAgentPermissions<K>> {
  return Object.fromEntries(Object.entries(byAgent).map(([id, entry]) => [id, {
    ...entry,
    ...(entry.capabilities ? { capabilities: { ...entry.capabilities } } : {}),
  }]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reject malformed per-agent overrides before any grant can reach a launch. */
function validateAgentPermissions<K extends string>({ value, capabilityKeys, message }: {
  value: unknown; capabilityKeys: readonly K[]; message: string;
}): Record<string, NativeAgentPermissions<K>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new InvalidNativePermissionsError({ message });
  for (const entry of Object.values(value)) validateAgentPermission({ value: entry, capabilityKeys, message });
  return value as Record<string, NativeAgentPermissions<K>>;
}

function validateAgentPermission<K extends string>({ value, capabilityKeys, message }: {
  value: unknown; capabilityKeys: readonly K[]; message: string;
}): void {
  if (!isRecord(value)) throw new InvalidNativePermissionsError({ message });
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new InvalidNativePermissionsError({ message });
  validateAgentCapabilities({ value: value.capabilities, capabilityKeys, message });
}

function validateAgentCapabilities<K extends string>({ value, capabilityKeys, message }: {
  value: unknown; capabilityKeys: readonly K[]; message: string;
}): void {
  if (value === undefined) return;
  if (!isRecord(value) || Object.entries(value).some(([key, entry]) =>
    typeof entry !== 'boolean' || !capabilityKeys.some(known => known === key))) throw new InvalidNativePermissionsError({ message });
}

/** Validate every known capability and the master flag before filling an untrusted snapshot.
 * Extra top-level capability keys are accepted; per-agent keys must be known.
 * @throws InvalidNativePermissionsError with only the host message, never a snapshot value.
 * @complexity O(k + a + p*k) time, O(k + a + p) space for k keys, a agents and p override entries.
 */
export function validateNativePermissionSnapshot<K extends string>(required: {
  value: unknown; capabilityKeys: readonly K[];
}, optional: { message?: string } = {}): NativePermissionSet<K> {
  const { value, capabilityKeys } = required;
  const message = optional.message ?? 'Invalid native permissions';
  if (!isRecord(value)) throw new InvalidNativePermissionsError({ message });
  const { enabled, capabilities, byAgent } = value;
  if (typeof enabled !== 'boolean' || !isRecord(capabilities) ||
    !capabilityKeys.every(key => typeof capabilities[key] === 'boolean')) throw new InvalidNativePermissionsError({ message });
  const agents = validateAgentPermissions({ value: byAgent, capabilityKeys, message });
  return fillNativePermissions({ capabilityKeys, enabled, capabilities: capabilities as Record<K, boolean>,
    ...(agents ? { byAgent: agents } : {}) });
}

/** Project one agent's choices after the host's grant gate; the master remains a default.
 * Returns a fresh snapshot with merged capabilities and no mutation or I/O.
 * @complexity O(k + a + p) time/space for k keys, a agents and p per-agent capability entries.
 */
export function projectNativePermissions<K extends string>(required: {
  settings: NativePermissionSet<K>; capabilityKeys: readonly K[]; agentId?: string;
}, _optional: Record<string, never> = {}): NativePermissionSet<K> {
  const { settings, capabilityKeys, agentId } = required;
  const override = agentId ? settings.byAgent?.[agentId] : undefined;
  return fillNativePermissions({ ...settings, capabilityKeys, enabled: override?.enabled ?? settings.enabled,
    capabilities: { ...settings.capabilities, ...override?.capabilities } });
}
