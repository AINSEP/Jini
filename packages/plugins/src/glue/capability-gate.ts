import type { GlueCapability } from './manifest.js';

export class GlueCapabilityDeniedError extends Error {
  readonly moduleId: string;
  readonly capability: GlueCapability;
  constructor(required: { moduleId: string; capability: GlueCapability }, _optional: Record<string, never> = {}) {
    super(`module '${required.moduleId}' invoked '${required.capability}' without declaring it in its manifest capabilities`);
    this.name = 'GlueCapabilityDeniedError';
    this.moduleId = required.moduleId;
    this.capability = required.capability;
  }
}
export type GlueCapabilityDelegate = (required: Readonly<Record<string, unknown>>, optional?: Readonly<Record<string, unknown>>) => unknown;
export interface BuildGlueCapabilityGateRequired {
  readonly moduleId: string;
  readonly vocabulary: readonly GlueCapability[];
  readonly capabilities: readonly GlueCapability[];
  readonly coreDelegates: Readonly<Record<GlueCapability, GlueCapabilityDelegate>>;
}
export type BuildGlueCapabilityGateOptional = Record<string, never>;

/** Grants and delegate references are snapshots; handles are frozen and denied slots stay callable. */
export function buildGlueCapabilityGate(required: BuildGlueCapabilityGateRequired, _optional: BuildGlueCapabilityGateOptional = {}): Readonly<Record<GlueCapability, GlueCapabilityDelegate>> {
  const granted = new Set(required.capabilities);
  const handle: Record<string, GlueCapabilityDelegate> = Object.create(null) as Record<string, GlueCapabilityDelegate>;
  for (const capability of required.vocabulary) {
    const delegate = Object.hasOwn(required.coreDelegates, capability) ? required.coreDelegates[capability] : undefined;
    handle[capability] = granted.has(capability) && typeof delegate === 'function'
      ? delegate
      : (_required: Readonly<Record<string, unknown>>, _optional?: Readonly<Record<string, unknown>>) => { throw new GlueCapabilityDeniedError({ moduleId: required.moduleId, capability }); };
  }
  return Object.freeze(handle);
}
