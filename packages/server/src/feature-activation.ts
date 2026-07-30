/**
 * @module feature-activation
 *
 * Decides which features a composition mounts, as a pure function of (profile, capability
 * overrides, feature overrides, catalog). Separated from `composeJiniKernel` so the whole activation
 * policy — the part with the security consequences — is unit-testable without booting a kernel,
 * opening a database, or binding a socket.
 *
 * The four rules, in the order they are applied:
 *
 * 1. **Capabilities are a ceiling.** `granted` starts at the profile's grant set and is adjusted by
 *    explicit overrides. A feature is *permitted* only if every capability it provides is granted.
 * 2. **An explicit enable can never beat a denied capability.** This is the rule that keeps a
 *    coarse "no network egress" switch meaningful: a caller cannot re-open it one feature at a time
 *    by naming that feature. Both halves are reported in the error so the fix is unambiguous.
 * 3. **Permitted is not active.** Under `core-only`, raising the ceiling activates nothing by
 *    itself — the caller still names what it wants. Under `all-permitted`, the ceiling *is* the
 *    selection, which is what makes a batteries-included daemon preset expressible.
 * 4. **Declared dependencies are validated, not documented.** A feature whose `requires` are not all
 *    active is a boot error naming both ends, never a half-mounted capability.
 *
 * An unknown feature id in an override is also a boot error. A silently-ignored typo in a
 * security-relevant config is the exact failure mode of a documented option that no code reads.
 */
import type { CapabilityId, JiniFeature, JiniProfile } from './feature.js';
import { CAPABILITY_IDS, CORE_CAPABILITIES, isCapabilityId } from './feature.js';

/** Why a feature ended up active. */
export type ActivationReason =
  /** The profile's activation policy selected it; the caller said nothing. */
  | 'default'
  /** The caller named it explicitly, and its capabilities were permitted. */
  | 'opt-in';

/** Why a feature ended up inactive. */
export type DeactivationReason =
  /** At least one capability it provides is not granted. */
  | 'capability-denied'
  /** Permitted, but the profile's activation policy does not default it on. */
  | 'not-default'
  /** The caller turned it off explicitly. */
  | 'opt-out';

export interface ActiveFeatureRecord {
  readonly id: string;
  readonly provides: readonly CapabilityId[];
  readonly reason: ActivationReason;
}

export interface InactiveFeatureRecord {
  readonly id: string;
  readonly provides: readonly CapabilityId[];
  readonly reason: DeactivationReason;
  /** The specific capabilities that blocked it. Empty unless `reason` is `capability-denied`. */
  readonly deniedCapabilities: readonly CapabilityId[];
}

export interface FeatureActivationInput {
  /** Every selectable feature, in the order they should compose. */
  readonly features: readonly JiniFeature[];
  readonly profile: JiniProfile;
  /**
   * Raises (`true`) or lowers (`false`) the profile's ceiling. An explicit `undefined` means "no
   * opinion" and leaves the profile's own grant untouched — `undefined` is admitted in the type
   * because building this object by optional spread is the normal way a host assembles it, and a
   * config that silently denied a capability because a spread produced `undefined` would be a
   * genuinely dangerous surprise.
   */
  readonly capabilities?: Readonly<Partial<Record<CapabilityId, boolean | undefined>>>;
  /** Names features on or off explicitly, within whatever ceiling the capabilities allow. `undefined` again means "no opinion". */
  readonly featureOverrides?: Readonly<Record<string, boolean | undefined>>;
}

export interface FeatureActivationPlan {
  /** Active features, in catalog order. */
  readonly active: readonly ActiveFeatureRecord[];
  /** Known-but-inactive features — so a host can tell "switched off" from "does not exist". */
  readonly inactive: readonly InactiveFeatureRecord[];
  readonly grantedCapabilities: readonly CapabilityId[];
  /** Every capability some catalogued feature needs that this composition does not grant. */
  readonly deniedCapabilities: readonly CapabilityId[];
}

function resolveGrants(input: FeatureActivationInput): Set<CapabilityId> {
  const granted = new Set<CapabilityId>(input.profile.grants);
  for (const [capability, enabled] of Object.entries(input.capabilities ?? {})) {
    if (enabled === undefined) continue;
    if (enabled) granted.add(capability as CapabilityId);
    else granted.delete(capability as CapabilityId);
  }
  return granted;
}

/**
 * Resolves the composition's feature plan.
 *
 * @throws If an override names an unknown feature id, if an explicitly-enabled feature needs a
 * denied capability, if two catalogued features share an id, or if an active feature's `requires`
 * are not satisfied. Every one of these is a composition-time programming/config error that would
 * otherwise surface as a mysteriously missing (or mysteriously present) route at runtime.
 * @complexity O(f · c) in features and their declared capabilities.
 */
export function resolveFeatureActivation(input: FeatureActivationInput): FeatureActivationPlan {
  const byId = new Map<string, JiniFeature>();
  for (const feature of input.features) {
    if (byId.has(feature.id)) {
      throw new Error(`jini: duplicate feature id "${feature.id}" in the composition catalog`);
    }
    byId.set(feature.id, feature);
  }

  const overrides = input.featureOverrides ?? {};
  for (const id of Object.keys(overrides)) {
    if (!byId.has(id)) {
      const known = [...byId.keys()].sort().join(', ');
      throw new Error(`jini: unknown feature "${id}" in features config — known features are: ${known}`);
    }
  }

  // Capability keys are validated for exactly the reason feature ids are, and the consequence is
  // worse: `{'host:exce': false}` deletes a grant nobody holds, so the correctly-spelled
  // `host:exec` survives and every feature it gates stays mounted. The typo reads as an applied
  // denial in the config and is not one — a security switch that fails *open* on a typo. TypeScript
  // catches this at a typed call site; a config parsed from JSON, YAML or env has no such call site.
  for (const capability of Object.keys(input.capabilities ?? {})) {
    if (!isCapabilityId(capability)) {
      const known = [...CAPABILITY_IDS].sort().join(', ');
      throw new Error(
        `jini: unknown capability "${capability}" in capabilities config — known capabilities are: ${known}`,
      );
    }
  }

  const granted = resolveGrants(input);
  const coreCapabilities = new Set<CapabilityId>(CORE_CAPABILITIES);

  const active: ActiveFeatureRecord[] = [];
  const inactive: InactiveFeatureRecord[] = [];
  const denied = new Set<CapabilityId>();

  for (const feature of input.features) {
    const missing = feature.provides.filter((capability) => !granted.has(capability));
    for (const capability of missing) denied.add(capability);

    const permitted = missing.length === 0;
    const explicit = overrides[feature.id];

    // Rule 2 — an explicit enable never overrides a denied capability, in either direction.
    if (explicit === true && !permitted) {
      throw new Error(
        `jini: feature "${feature.id}" was explicitly enabled but requires denied ` +
          `capabilit${missing.length > 1 ? 'ies' : 'y'} [${missing.join(', ')}] under profile ` +
          `"${input.profile.id}". Grant them via config.capabilities, or remove "${feature.id}" from config.features.`,
      );
    }

    if (explicit === false) {
      inactive.push({ id: feature.id, provides: feature.provides, reason: 'opt-out', deniedCapabilities: [] });
      continue;
    }
    if (explicit === true) {
      active.push({ id: feature.id, provides: feature.provides, reason: 'opt-in' });
      continue;
    }
    if (!permitted) {
      inactive.push({
        id: feature.id,
        provides: feature.provides,
        reason: 'capability-denied',
        deniedCapabilities: missing,
      });
      continue;
    }

    // Rule 3 — permitted is not active. `core-only` still requires the caller to name it.
    const defaultOn =
      input.profile.activation === 'all-permitted' ||
      feature.provides.every((capability) => coreCapabilities.has(capability));

    if (defaultOn) active.push({ id: feature.id, provides: feature.provides, reason: 'default' });
    else inactive.push({ id: feature.id, provides: feature.provides, reason: 'not-default', deniedCapabilities: [] });
  }

  // Rule 4 — dependencies validated after the full active set is known, so declaration order in the
  // catalog never decides whether a legitimate configuration is accepted.
  const activeIds = new Set(active.map((record) => record.id));
  for (const record of active) {
    for (const required of byId.get(record.id)!.requires ?? []) {
      if (!byId.has(required)) {
        throw new Error(`jini: feature "${record.id}" declares requires "${required}", which is not a known feature`);
      }
      if (!activeIds.has(required)) {
        throw new Error(
          `jini: feature "${record.id}" requires "${required}", which is not active — ` +
            `enable "${required}" or disable "${record.id}".`,
        );
      }
    }
  }

  return {
    active,
    inactive,
    grantedCapabilities: [...granted],
    deniedCapabilities: [...denied],
  };
}
