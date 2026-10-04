import type { PortMap, PortValues } from './token.js';
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
