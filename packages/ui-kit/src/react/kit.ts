import { KIT_CONTRACT, implementedComponents, kitSpec, type ImplementedComponentName } from '../kit.spec.js';
import { assertKitContract, KitConfigError } from '../needs.js';
import { nativeKit } from './native/index.js';
import type { GuardMode, ReactKit, ResolvedKit } from './types.js';
type KitOptions = { id?: string; contract?: string; guard?: GuardMode };
export function createKit(required: { components?: Partial<ReactKit> }, optional: KitOptions = {}): ResolvedKit {
  const contract = optional.contract ?? KIT_CONTRACT.version;
  assertKitContract({ contract });
  const overrides = implementedComponents.filter(name => required.components?.[name] !== undefined);
  const issues = overrides.filter(name => {
    // Runtime callers can bypass TypeScript; validate unknown rather than assuming ComponentType's callable shape.
    const component: unknown = required.components![name];
    if (typeof component === 'function') return false;
    if (typeof component !== 'object' || component === null || !('$$typeof' in component)) return true;
    return ![Symbol.for('react.forward_ref'), Symbol.for('react.memo'), Symbol.for('react.lazy')].includes(component.$$typeof as symbol);
  });
  if (issues.length) throw new KitConfigError({ issues: issues.map(name => `${name} is not a component`) });
  const components = { ...nativeKit };
  // Ignore explicit undefined rather than erasing a working native default.
  for (const name of overrides) Object.assign(components, { [name]: required.components![name] });
  return Object.freeze({ id: optional.id ?? 'native', contract, components: Object.freeze(components),
    overrides: Object.freeze(overrides), violations: [], failed: new Set<ImplementedComponentName>(), guard: optional.guard ?? 'fallback' });
}
export function createStrictKit(required: { components: ReactKit }, optional: KitOptions = {}): ResolvedKit {
  const missing = implementedComponents.filter(name => required.components[name] === undefined);
  if (missing.length) throw new KitConfigError({ issues: missing.map(name => `missing ${name}`) });
  return createKit(required, optional);
}
export function extendKit(required: { base: ResolvedKit; components: Partial<ReactKit> }, optional: KitOptions = {}): ResolvedKit {
  const inherited = Object.fromEntries(required.base.overrides.map(name => [name, required.base.components[name]]));
  return createKit({ components: { ...inherited, ...required.components } },
    { id: optional.id ?? required.base.id, contract: optional.contract ?? required.base.contract, guard: optional.guard ?? required.base.guard });
}
export function describeKit(required: { kit: ResolvedKit }, _optional: Record<string, never> = {}) {
  const { kit } = required;
  const coverage = implementedComponents.map(name => ({ component: name, parts: kitSpec[name].parts,
    source: kit.failed.has(name) ? 'native-guard' as const : kit.overrides.includes(name) ? 'override' as const : 'native' as const }));
  return { id: kit.id, contract: kit.contract, coverage,
    fallbacks: coverage.filter(entry => entry.source !== 'override').map(entry => entry.component),
    violations: kit.violations.map(violation => ({ ...violation, reasons: [...violation.reasons] })) };
}
