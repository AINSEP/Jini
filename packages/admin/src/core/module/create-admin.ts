import type { AdminDescription, AdminInstance, AdminModule, TabId, ScopedPorts } from './types.js';
import type { AdminPortToken, PortMap, PortValues } from './token.js';
export class AdminConfigError extends Error {
  readonly issues: readonly string[];
  constructor({ issues }: { issues: readonly string[] }, _optional: Record<string, never> = {}) {
    super(`Invalid admin configuration:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'AdminConfigError';
    this.issues = Object.freeze([...issues]);
  }
}
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never;
type TabMaps<M extends AdminModule> = {
  [P in keyof M['pages']]: {
    [T in keyof M['pages'][P]['tabs']]: M['pages'][P]['tabs'][T] extends infer Tab
      ? Tab extends { requires: infer R extends PortMap }
        ? R
        : {}
      : never;
  }[keyof M['pages'][P]['tabs']];
}[keyof M['pages']];
type OptionalTabMaps<M extends AdminModule> = {
  [P in keyof M['pages']]: {
    [T in keyof M['pages'][P]['tabs']]: M['pages'][P]['tabs'][T] extends {
      optional: infer R extends PortMap;
    }
      ? R
      : {};
  }[keyof M['pages'][P]['tabs']];
}[keyof M['pages']];
type Values<P> = P extends PortMap ? PortValues<P> : {};
type RequiredValues<M extends AdminModule> = M extends unknown
  ? PortValues<NonNullable<M['requires']>> & UnionToIntersection<Values<TabMaps<M>>>
  : never;
type ProvidedNames<M extends AdminModule> = M extends unknown
  ? keyof NonNullable<M['provides']>
  : never;
type AllValues<M extends AdminModule> = M extends unknown
  ? RequiredValues<M> &
      UnionToIntersection<Values<OptionalTabMaps<M>>> &
      PortValues<NonNullable<M['optional']>> &
      PortValues<NonNullable<M['provides']>>
  : never;
export type AdminHostPorts<Ms extends readonly AdminModule[]> = Omit<
  UnionToIntersection<RequiredValues<Ms[number]>>,
  ProvidedNames<Ms[number]>
> &
  Partial<UnionToIntersection<AllValues<Ms[number]>>>;
export interface AdminOptions<Ms extends readonly AdminModule[]> {
  readonly omit?: readonly TabId<Ms[number]>[];
  /** Host collisions are rejected unless the provider name is explicitly listed here. */
  readonly overrides?: readonly ProvidedNames<Ms[number]>[];
  /** No grant means no page/tab access. This UI gate does not replace server authorization. */
  readonly permissions?: readonly string[];
}
export function createAdmin<
  const Ms extends readonly AdminModule[],
  const P extends AdminHostPorts<Ms>,
>(
  {
    modules,
    ports,
  }: { modules: Ms; ports: P & Record<Exclude<keyof P, keyof AdminHostPorts<Ms>>, never> },
  options: AdminOptions<Ms> = {},
): AdminInstance {
  const issues: string[] = [];
  const tokens = new Map<string, AdminPortToken>();
  const identities = new Map<string, string>();
  const providers = new Map<string, AdminModule>();
  const ids = new Set<string>(),
    paths = new Set<string>(),
    tabIds = new Set<string>();
  const requiredNames = new Set<string>();
  const host: Readonly<Record<string, unknown>> = ports;
  const values: Record<string, unknown> = { ...host };
  const omitted = new Set<string>(options.omit ?? []);
  const grants = new Set(options.permissions ?? []);
  const allowed = (permissions: readonly string[] = []) => permissions.every((p) => grants.has(p));
  function collect(map: PortMap = {}, required = false) {
    for (const [name, tok] of Object.entries(map)) {
      const old = tokens.get(name);
      if (!tok.id || tok.cardinality !== 'one' || !Number.isInteger(tok.version) || tok.version < 1)
        issues.push(`Invalid token: ${name}`);
      if (old && (old.id !== tok.id || old.version !== tok.version))
        issues.push(`Incompatible token: ${name}`);
      const alias = identities.get(tok.id);
      if (alias && alias !== name)
        issues.push(`Token ${tok.id} has conflicting names: ${alias}, ${name}`);
      identities.set(tok.id, name);
      tokens.set(name, tok);
      if (required) requiredNames.add(name);
    }
  }
  for (const module of modules) {
    if (ids.has(module.id)) issues.push(`Duplicate module: ${module.id}`);
    ids.add(module.id);
    collect(module.requires, true);
    collect(module.optional);
    collect(module.provides);
    for (const name of Object.keys(module.provides ?? {})) {
      if (providers.has(name)) issues.push(`Duplicate provider: ${name}`);
      providers.set(name, module);
      if (
        host[name] != null &&
        !(options.overrides as readonly string[] | undefined)?.includes(name)
      )
        issues.push(`Provider collision: ${name}; declare an override`);
      if (!module.factories?.[name] && host[name] == null)
        issues.push(`Missing provider factory: ${name}`);
    }
    for (const name of Object.keys(module.factories ?? {}))
      if (!(name in (module.provides ?? {}))) issues.push(`Undeclared provider factory: ${name}`);
    for (const [pageId, page] of Object.entries(module.pages)) {
      if (paths.has(page.path)) issues.push(`Duplicate route: ${page.path}`);
      paths.add(page.path);
      for (const [tabId, tab] of Object.entries(page.tabs)) {
        const full = `${module.id}.${pageId}.${tabId}`;
        tabIds.add(full);
        collect(tab.requires, !omitted.has(full));
        collect(tab.optional);
      }
    }
  }
  for (const id of omitted) if (!tabIds.has(id)) issues.push(`Unknown tab: ${id}`);
  for (const name of options.overrides ?? [])
    if (!providers.has(String(name))) issues.push(`Unknown provider override: ${String(name)}`);
  for (const name of Object.keys(host)) if (!tokens.has(name)) issues.push(`Unknown port: ${name}`);
  for (const name of requiredNames)
    if (host[name] == null && !providers.has(name)) issues.push(`Missing port: ${name}`);
  // Validate the graph before executing factories, so a boot error has no partial side effects.
  const sorted: string[] = [],
    visiting = new Set<string>(),
    visited = new Set<string>();
  function visit(name: string, chain: readonly string[]) {
    if (visited.has(name) || host[name] != null) return;
    if (visiting.has(name)) {
      issues.push(`Provider cycle: ${[...chain, name].join(' -> ')}`);
      return;
    }
    visiting.add(name);
    const module = providers.get(name)!;
    for (const dep of Object.keys(dependencies(module)))
      if (providers.has(dep)) visit(dep, [...chain, name]);
    visiting.delete(name);
    visited.add(name);
    sorted.push(name);
  }
  for (const name of providers.keys()) visit(name, []);
  if (issues.length) throw new AdminConfigError({ issues: [...new Set(issues)] });
  const disposables: { dispose: () => void }[] = [];
  function dependencies(module: AdminModule) {
    const tabPorts = Object.values(module.pages)
      .flatMap((page) => Object.values(page.tabs))
      .reduce<PortMap>((result, tab) => ({ ...result, ...tab.requires, ...tab.optional }), {});
    return { ...module.requires, ...module.optional, ...tabPorts };
  }
  function narrow(module: AdminModule) {
    return Object.freeze(
      Object.fromEntries(Object.keys(dependencies(module)).map((name) => [name, values[name]])),
    );
  }
  try {
    for (const name of sorted) {
      const value = providers.get(name)!.factories![name]!(
        { ports: narrow(providers.get(name)!), permissions: [...grants] },
        {},
      );
      if (value == null) throw new Error(`Provider returned no value: ${name}`);
      values[name] = value;
      if (typeof value === 'object' && 'dispose' in value && typeof value.dispose === 'function')
        disposables.push(value as { dispose: () => void });
    }
  } catch (error) {
    for (const value of disposables.reverse()) value.dispose();
    throw new AdminConfigError({
      issues: [error instanceof Error ? error.message : 'Provider initialization failed'],
    });
  }
  const description: AdminDescription = Object.freeze({
    modules: Object.freeze([...ids]),
    pages: Object.freeze(
      modules.flatMap((module) =>
        Object.entries(module.pages).map(([id, page]) => ({
          id: `${module.id}.${id}`,
          path: page.path,
          label: page.label,
          visible: allowed(page.permissions),
          agentReachable: page.agentReachable === true && allowed(page.permissions),
          permissions: page.permissions ?? [],
          grants: Object.freeze([...grants]),
          ...(page.nav ? { nav: page.nav } : {}),
          tabs: Object.entries(page.tabs).map(([tabId, tab]) => {
            const full = `${module.id}.${id}.${tabId}`;
            const absent = Object.keys(tab.optional ?? {}).find((name) => values[name] == null);
            const reason = omitted.has(full)
              ? 'omitted'
              : !allowed(page.permissions) || !allowed(tab.permissions)
              ? 'permission denied'
              : absent
              ? `optional port unavailable: ${absent}`
              : null;
            return {
              id: full,
              label: tab.label,
              visible: reason === null,
              reason,
              params: tab.params ?? {},
              agentReachable:
                reason === null && page.agentReachable === true && tab.agentReachable === true,
            };
          }),
        })),
      ),
    ),
    ports: Object.freeze(
      [...tokens]
        .filter(([name]) => values[name] != null)
        .map(([name, tok]) => ({
          name,
          token: tok.id,
          version: tok.version,
          source: host[name] != null ? ('host' as const) : ('module' as const),
        })),
    ),
  });
  let disposed = false;
  return {
    describe: () => description,
    scope: <M extends AdminModule>({ module }: { module: M }): ScopedPorts<M> => {
      if (disposed || !modules.includes(module))
        throw new AdminConfigError({ issues: [`Module scope unavailable: ${module.id}`] });
      return narrow(module) as ScopedPorts<M>;
    },
    dispose: () => {
      if (!disposed) {
        disposed = true;
        for (const value of disposables.reverse()) value.dispose();
      }
    },
  };
}
