import type {
  AdminDescription,
  AdminInstance,
  AdminModule,
  AdminPage,
  AdminTab,
  TabId,
  ScopedPorts,
} from './types.js';
import type { AdminPortToken, PortMap, PortValues } from './token.js';
const bulletLine = (issue: string) => `- ${issue}`;
export class AdminConfigError extends Error {
  readonly issues: readonly string[];
  constructor({ issues }: { issues: readonly string[] }, _optional: Record<string, never> = {}) {
    super(`Invalid admin configuration:\n${issues.map(bulletLine).join('\n')}`);
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
type Ports = Readonly<Record<string, unknown>>;
type Disposable = { dispose: () => void };
/** Everything boot learns from the module list; every rule below appends to `issues`. */
interface Registry {
  readonly host: Ports;
  readonly issues: string[];
  readonly tokens: Map<string, AdminPortToken>;
  readonly identities: Map<string, string>;
  readonly providers: Map<string, AdminModule>;
  readonly requiredNames: Set<string>;
  readonly ids: Set<string>;
  readonly paths: Set<string>;
  readonly tabIds: Set<string>;
}
function isValidToken(tok: AdminPortToken) {
  return (
    Boolean(tok.id) &&
    tok.cardinality === 'one' &&
    Number.isInteger(tok.version) &&
    tok.version >= 1
  );
}
function checkToken(
  { registry, name, tok }: { registry: Registry; name: string; tok: AdminPortToken },
  _optional: Record<string, never> = {},
) {
  const { issues } = registry;
  if (!isValidToken(tok)) issues.push(`Invalid token: ${name}`);
  const old = registry.tokens.get(name);
  if (old && (old.id !== tok.id || old.version !== tok.version))
    issues.push(`Incompatible token: ${name}`);
  const alias = registry.identities.get(tok.id);
  if (alias && alias !== name)
    issues.push(`Token ${tok.id} has conflicting names: ${alias}, ${name}`);
}
function collectTokens(
  { registry, map }: { registry: Registry; map: PortMap | undefined },
  { required = false }: { required?: boolean } = {},
) {
  for (const [name, tok] of Object.entries(map ?? {})) {
    checkToken({ registry, name, tok });
    registry.identities.set(tok.id, name);
    registry.tokens.set(name, tok);
    if (required) registry.requiredNames.add(name);
  }
}
function checkProvider(
  {
    registry,
    module,
    name,
    overrides,
  }: { registry: Registry; module: AdminModule; name: string; overrides: readonly string[] },
  _optional: Record<string, never> = {},
) {
  const { issues, providers } = registry;
  if (providers.has(name)) issues.push(`Duplicate provider: ${name}`);
  providers.set(name, module);
  const hosted = registry.host[name] != null;
  if (hosted && !overrides.includes(name))
    issues.push(`Provider collision: ${name}; declare an override`);
  if (!module.factories?.[name] && !hosted) issues.push(`Missing provider factory: ${name}`);
}
function registerProviders(
  {
    registry,
    module,
    overrides,
  }: { registry: Registry; module: AdminModule; overrides: readonly string[] },
  _optional: Record<string, never> = {},
) {
  const provides = module.provides ?? {};
  for (const name of Object.keys(provides)) checkProvider({ registry, module, name, overrides });
  for (const name of Object.keys(module.factories ?? {}))
    if (!(name in provides)) registry.issues.push(`Undeclared provider factory: ${name}`);
}
function registerPages(
  {
    registry,
    module,
    omitted,
  }: { registry: Registry; module: AdminModule; omitted: ReadonlySet<string> },
  _optional: Record<string, never> = {},
) {
  const { issues, paths, tabIds } = registry;
  for (const [pageId, page] of Object.entries(module.pages)) {
    if (paths.has(page.path)) issues.push(`Duplicate route: ${page.path}`);
    paths.add(page.path);
    for (const [tabId, tab] of Object.entries(page.tabs)) {
      const full = `${module.id}.${pageId}.${tabId}`;
      tabIds.add(full);
      collectTokens({ registry, map: tab.requires }, { required: !omitted.has(full) });
      collectTokens({ registry, map: tab.optional });
    }
  }
}
function registerModules(
  {
    modules,
    host,
    omitted,
    overrides,
  }: {
    modules: readonly AdminModule[];
    host: Ports;
    omitted: ReadonlySet<string>;
    overrides: readonly string[];
  },
  _optional: Record<string, never> = {},
): Registry {
  const registry: Registry = {
    host,
    issues: [],
    tokens: new Map(),
    identities: new Map(),
    providers: new Map(),
    requiredNames: new Set(),
    ids: new Set(),
    paths: new Set(),
    tabIds: new Set(),
  };
  for (const module of modules) {
    if (registry.ids.has(module.id)) registry.issues.push(`Duplicate module: ${module.id}`);
    registry.ids.add(module.id);
    collectTokens({ registry, map: module.requires }, { required: true });
    collectTokens({ registry, map: module.optional });
    collectTokens({ registry, map: module.provides });
    registerProviders({ registry, module, overrides });
    registerPages({ registry, module, omitted });
  }
  return registry;
}
function checkOptions(
  {
    registry,
    omitted,
    overrides,
  }: { registry: Registry; omitted: ReadonlySet<string>; overrides: readonly string[] },
  _optional: Record<string, never> = {},
) {
  const { issues } = registry;
  for (const id of omitted) if (!registry.tabIds.has(id)) issues.push(`Unknown tab: ${id}`);
  for (const name of overrides)
    if (!registry.providers.has(name)) issues.push(`Unknown provider override: ${name}`);
}
function checkPorts({ registry }: { registry: Registry }, _optional: Record<string, never> = {}) {
  const { host, issues, providers } = registry;
  for (const name of Object.keys(host))
    if (!registry.tokens.has(name)) issues.push(`Unknown port: ${name}`);
  for (const name of registry.requiredNames)
    if (host[name] == null && !providers.has(name)) issues.push(`Missing port: ${name}`);
}
function dependencies(module: AdminModule) {
  const tabPorts = Object.values(module.pages)
    .flatMap((page) => Object.values(page.tabs))
    .reduce<PortMap>((result, tab) => ({ ...result, ...tab.requires, ...tab.optional }), {});
  return { ...module.requires, ...module.optional, ...tabPorts };
}
/** Depth-first topological order of the providers the host does not already supply. */
function orderProviders(
  { registry }: { registry: Registry },
  _optional: Record<string, never> = {},
) {
  const { host, issues, providers } = registry;
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
    for (const dep of Object.keys(dependencies(providers.get(name)!)))
      if (providers.has(dep)) visit(dep, [...chain, name]);
    visiting.delete(name);
    visited.add(name);
    sorted.push(name);
  }
  for (const name of providers.keys()) visit(name, []);
  return sorted;
}
function narrow({ module, values }: { module: AdminModule; values: Ports }) {
  return Object.freeze(
    Object.fromEntries(Object.keys(dependencies(module)).map((name) => [name, values[name]])),
  );
}
function isDisposable(value: unknown): value is Disposable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'dispose' in value &&
    typeof value.dispose === 'function'
  );
}
function disposeAll(disposables: readonly Disposable[]) {
  for (const value of [...disposables].reverse()) value.dispose();
}
/** Runs factories in dependency order; a failure disposes what was built and reports one issue. */
function instantiate(
  {
    providers,
    sorted,
    values,
    grants,
  }: {
    providers: ReadonlyMap<string, AdminModule>;
    sorted: readonly string[];
    values: Record<string, unknown>;
    grants: readonly string[];
  },
  _optional: Record<string, never> = {},
): Disposable[] {
  const disposables: Disposable[] = [];
  try {
    for (const name of sorted) {
      const module = providers.get(name)!;
      const value = module.factories![name]!(
        { ports: narrow({ module, values }), permissions: [...grants] },
        {},
      );
      if (value == null) throw new Error(`Provider returned no value: ${name}`);
      values[name] = value;
      if (isDisposable(value)) disposables.push(value);
    }
  } catch (error) {
    disposeAll(disposables);
    throw new AdminConfigError({
      issues: [error instanceof Error ? error.message : 'Provider initialization failed'],
    });
  }
  return disposables;
}
interface DescribeContext {
  readonly values: Ports;
  readonly omitted: ReadonlySet<string>;
  readonly grants: ReadonlySet<string>;
}
const allowed = ({ grants }: DescribeContext, permissions: readonly string[] = []) =>
  permissions.every((p) => grants.has(p));
function tabReason(
  {
    context,
    full,
    page,
    tab,
  }: { context: DescribeContext; full: string; page: AdminPage; tab: AdminTab },
  _optional: Record<string, never> = {},
) {
  if (context.omitted.has(full)) return 'omitted';
  if (!allowed(context, page.permissions) || !allowed(context, tab.permissions))
    return 'permission denied';
  const absent = Object.keys(tab.optional ?? {}).find((name) => context.values[name] == null);
  return absent ? `optional port unavailable: ${absent}` : null;
}
function describePage(
  {
    context,
    module,
    id,
    page,
  }: {
    context: DescribeContext;
    module: AdminModule;
    id: string;
    page: AdminPage;
  },
  _optional: Record<string, never> = {},
) {
  const visible = allowed(context, page.permissions);
  return {
    id: `${module.id}.${id}`,
    path: page.path,
    label: page.label,
    visible,
    agentReachable: page.agentReachable === true && visible,
    permissions: page.permissions ?? [],
    grants: Object.freeze([...context.grants]),
    ...(page.nav ? { nav: page.nav } : {}),
    tabs: Object.entries(page.tabs).map(([tabId, tab]) => {
      const full = `${module.id}.${id}.${tabId}`;
      const reason = tabReason({ context, full, page, tab });
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
  };
}
function describeAdmin(
  {
    modules,
    registry,
    context,
  }: {
    modules: readonly AdminModule[];
    registry: Registry;
    context: DescribeContext;
  },
  _optional: Record<string, never> = {},
): AdminDescription {
  const { host } = registry;
  return Object.freeze({
    modules: Object.freeze([...registry.ids]),
    pages: Object.freeze(
      modules.flatMap((module) =>
        Object.entries(module.pages).map(([id, page]) =>
          describePage({ context, module, id, page }),
        ),
      ),
    ),
    ports: Object.freeze(
      [...registry.tokens]
        .filter(([name]) => context.values[name] != null)
        .map(([name, tok]) => ({
          name,
          token: tok.id,
          version: tok.version,
          source: host[name] != null ? ('host' as const) : ('module' as const),
        })),
    ),
  });
}
export function createAdmin<
  const Ms extends readonly AdminModule[],
  const P extends AdminHostPorts<Ms>,
>(
  {
    modules,
    ports,
  }: {
    modules: Ms;
    ports: P & Record<Exclude<keyof P, keyof AdminHostPorts<Ms>>, never>;
  },
  options: AdminOptions<Ms> = {},
): AdminInstance {
  const host: Ports = ports;
  const values: Record<string, unknown> = { ...host };
  const omitted = new Set<string>(options.omit ?? []);
  const overrides = (options.overrides ?? []).map(String);
  const grants = new Set(options.permissions ?? []);
  const registry = registerModules({ modules, host, omitted, overrides });
  checkOptions({ registry, omitted, overrides });
  checkPorts({ registry });
  // Validate the graph before executing factories, so a boot error has no partial side effects.
  const sorted = orderProviders({ registry });
  if (registry.issues.length) throw new AdminConfigError({ issues: [...new Set(registry.issues)] });
  const disposables = instantiate({
    providers: registry.providers,
    sorted,
    values,
    grants: [...grants],
  });
  const description = describeAdmin({
    modules,
    registry,
    context: { values, omitted, grants },
  });
  let disposed = false;
  return {
    describe: () => description,
    scope: <M extends AdminModule>({ module }: { module: M }): ScopedPorts<M> => {
      if (disposed || !modules.includes(module))
        throw new AdminConfigError({
          issues: [`Module scope unavailable: ${module.id}`],
        });
      return narrow({ module, values }) as ScopedPorts<M>;
    },
    dispose: () => {
      if (!disposed) {
        disposed = true;
        disposeAll(disposables);
      }
    },
  };
}
