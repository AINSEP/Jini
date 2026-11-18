/**
 * @file Admin-module descriptor vocabulary: the plain data a feature package exports so a host can
 * register it with an admin shell, plus typed port tokens. Pure: no registry, no React, no I/O.
 * The registry (`createAdmin`) lives in the admin package; a module package imports only this file.
 */
import { token, type Token } from '../token.js';
import type { ControllerStore } from '../admin-runtime/controller-store.js';
/** Admin port tokens are core tokens, frozen so a registered identity cannot be mutated after boot. */
export type AdminPortToken<T = unknown, Id extends string = string> = Token<T, Id>;
export function adminPort<T, const Id extends string = string>(
  { id }: { id: Id },
  { version = 1 }: { version?: number } = {},
): AdminPortToken<T, Id> {
  return Object.freeze(token<T, Id>({ id }, { version }));
}
export type PortMap = Readonly<Record<string, AdminPortToken>>;
export type PortValues<P extends PortMap> = {
  readonly [K in keyof P]: P[K] extends AdminPortToken<infer T> ? T : never;
};
export interface AdminTab {
  readonly label: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly requires?: PortMap;
  /** A tab depending on an unwired optional port is hidden, with a reason in describe(). */
  readonly optional?: PortMap;
  readonly permissions?: readonly string[];
  readonly agentReachable?: boolean;
}
export interface AdminPage {
  readonly path: string;
  readonly label: string;
  readonly nav?: { readonly group: string; readonly icon?: string };
  readonly permissions?: readonly string[];
  readonly agentReachable?: boolean;
  readonly tabs: Readonly<Record<string, AdminTab>>;
}
export interface AdminModule {
  readonly id: string;
  readonly requires?: PortMap;
  readonly optional?: PortMap;
  readonly provides?: PortMap;
  readonly pages: Readonly<Record<string, AdminPage>>;
  readonly messages?: Readonly<Record<string, string>>;
  readonly factories?: Readonly<
    Record<
      string,
      (
        required: { ports: Readonly<Record<string, unknown>>; permissions: readonly string[] },
        optional?: Record<string, never>,
      ) => unknown
    >
  >;
}
type Intersect<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;
type TabPortValues<M extends AdminModule> = {
  [P in keyof M['pages']]: {
    [T in keyof M['pages'][P]['tabs']]: M['pages'][P]['tabs'][T] extends infer Tab
      ? Tab extends AdminTab
        ? PortValues<NonNullable<Tab['requires']>> & PortValues<NonNullable<Tab['optional']>>
        : {}
      : never;
  }[keyof M['pages'][P]['tabs']];
}[keyof M['pages']];
export type ScopedPorts<M extends AdminModule> = PortValues<NonNullable<M['requires']>> &
  Partial<PortValues<NonNullable<M['optional']>> & Intersect<TabPortValues<M>>>;
export type TabId<M extends AdminModule> = M extends unknown
  ? {
      [P in keyof M['pages'] & string]: `${M['id']}.${P}.${keyof M['pages'][P]['tabs'] & string}`;
    }[keyof M['pages'] & string]
  : never;
export interface AdminDescription {
  readonly modules: readonly string[];
  readonly pages: readonly {
    id: string;
    path: string;
    label: string;
    visible: boolean;
    agentReachable: boolean;
    permissions: readonly string[];
    grants: readonly string[];
    nav?: AdminPage['nav'];
    tabs: readonly {
      id: string;
      label: string;
      visible: boolean;
      reason: string | null;
      params: Readonly<Record<string, unknown>>;
      agentReachable: boolean;
    }[];
  }[];
  readonly ports: readonly {
    name: string;
    token: string;
    version: number;
    source: 'host' | 'module';
  }[];
}
export interface AdminInstance {
  describe(required?: Record<string, never>, optional?: Record<string, never>): AdminDescription;
  scope<M extends AdminModule>(
    required: { module: M },
    optional?: Record<string, never>,
  ): ScopedPorts<M>;
  dispose(required?: Record<string, never>, optional?: Record<string, never>): void;
}
/** What the shell passes a module's tab view. */
export interface TabViewProps {
  readonly params: Readonly<Record<string, unknown>>;
  readonly permissions?: readonly string[];
}
/** What the shell passes a module's page. `Tab` is the renderer's tab component; core names no UI library. */
export interface ModulePageProps<Tab = unknown> {
  readonly tabs: Readonly<Record<string, Tab>>;
  readonly description: AdminDescription['pages'][number];
  readonly requestedTab?: string;
  readonly onTabChange?: (required: { tab: string }, optional?: Record<string, never>) => void;
}
type ViewLoader = () => Promise<{ readonly default: unknown }>;
/** One lazy loader per page and per tab of the module. */
export type ModuleViews<M extends AdminModule> = {
  readonly [P in keyof M['pages']]: {
    readonly page: ViewLoader;
    readonly tabs: { readonly [T in keyof M['pages'][P]['tabs']]: ViewLoader };
  };
};
/** A module's bound views. `Page`, `Tab` and `Provider` are the renderer's component types. */
export interface ModuleBinding<M extends AdminModule, Page, Tab, Provider> {
  readonly module: M;
  readonly pages: {
    readonly [P in keyof M['pages']]: {
      readonly Page: Page;
      readonly tabs: { readonly [T in keyof M['pages'][P]['tabs']]: Tab };
    };
  };
  readonly Provider: Provider;
  usePorts(required?: Record<string, never>, optional?: Record<string, never>): ScopedPorts<M>;
}
/** Creates the controller after commit, disposes it on cleanup, and reads its snapshot. */
export type UseAdminController = <C extends ControllerStore<unknown>>(
  required: { create: () => C; dependencies: readonly unknown[] },
  optional?: { start?: (required: { controller: C }, optional?: Record<string, never>) => void },
) => { controller: C | null; snapshot: ReturnType<C['getSnapshot']> | null };
/**
 * The renderer helpers a module's screens receive from the host. Owner answer 2026-11-17 (J4):
 * a module package states this contract and is injected with the implementation; it never imports
 * one, so the host (which wires `@jini-ai/admin`'s React pair) decides which renderer runs.
 * `bindReact` is a method so the implementation may take the renderer's own context type for
 * `context`, the module's ports context (method parameters are checked bivariantly).
 */
export interface AdminModuleUi<Page, Tab, Provider> {
  bindReact<const M extends AdminModule>(
    required: { module: M; views: ModuleViews<M> },
    optional?: { context?: object },
  ): ModuleBinding<M, Page, Tab, Provider>;
  readonly useController: UseAdminController;
}
/** Definition is data only; boot validates identities before any factory runs. */
export function defineAdminModule<const M extends AdminModule>(
  required: M,
  _optional: Record<string, never> = {},
): M {
  return Object.freeze(required);
}
