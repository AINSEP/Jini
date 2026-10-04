import { KIT_CONTRACT, kitSpec, type KitComponentName } from './kit.spec.js';
export interface KitNeeds<N extends KitComponentName = KitComponentName> {
  readonly id: string; readonly contract: string; readonly components: readonly N[];
}
export class KitConfigError extends Error {
  readonly code = 'KIT_CONFIG';
  readonly issues: readonly string[];
  constructor(required: { issues: readonly string[] }, _optional: Record<string, never> = {}) {
    super(`Invalid UI kit: ${required.issues.join('; ')}`); this.name = 'KitConfigError'; this.issues = Object.freeze([...required.issues]);
  }
}
/** Exact contract versions and ^major[.minor[.patch]] are deliberately the whole supported grammar. */
export function assertKitContract(required: { contract: string }, _optional: Record<string, never> = {}): void {
  const { contract } = required;
  const match = /^\^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(contract);
  const [major, minor, patch] = KIT_CONTRACT.version.split('.').map(Number);
  const compatible = match ? Number(match[1]) === major && (Number(match[2] ?? 0) < minor! ||
    (Number(match[2] ?? 0) === minor && Number(match[3] ?? 0) <= patch!)) : contract === KIT_CONTRACT.version;
  if (!compatible) throw new KitConfigError({ issues: [`contract ${contract} is incompatible with ${KIT_CONTRACT.version}`] });
}
export function needs<const N extends readonly KitComponentName[]>(
  required: { id: string; components: N }, optional: { contract?: string } = {},
): KitNeeds<N[number]> {
  const contract = optional.contract ?? '^1';
  assertKitContract({ contract });
  const issues = required.components.filter(name => kitSpec[name]?.status !== 'implemented').map(name => `${name} is planned, not implemented`);
  if (issues.length) throw new KitConfigError({ issues });
  return Object.freeze({ ...required, components: Object.freeze([...required.components]), contract });
}
