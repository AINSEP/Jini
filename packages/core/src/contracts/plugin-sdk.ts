/** @agent-note Types, one constant, and three pure helpers. The type closure a plugin provider implements against;
 * the manifest validator, provider host and contribution registry stay with the plugin host. */
import type { PluginLookupPort } from "@jini-ai/core/plugin-directory";
import { captureLineTail } from "../text/index.js";

/** Plain serializable entry envelope; hosts extend it with their own hook payload fields. */
export interface ContentEntryDraft {
  readonly workspaceId: string;
  readonly ext: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
export interface HookContext { readonly pluginId: string; readonly workspaceId: string }
export type ExtPatch = Readonly<Record<string, string | number | boolean>>;
/** Positional callbacks are the existing plugin wire ABI, not Jini factory boundaries. */
export type BeforeSaveFilter = (entry: Readonly<ContentEntryDraft>, ctx: HookContext) => ExtPatch | Promise<ExtPatch>;
export type HookPoints = Readonly<Record<string, unknown>>;
export interface PluginSdk<H extends HookPoints = HookPoints> {
  readonly providers: PluginProvidersSdk;
  readonly plugins?: PluginLookupPort;
  readonly content: { read(): Readonly<ContentEntryDraft>; extend(field: string, value: string | number | boolean): void };
  addFilter<K extends keyof H & string>(hookName: K, filter: H[K] extends (...args: never[]) => unknown ? H[K] : BeforeSaveFilter): void;
  readonly routes: { add(required: PluginRouteContribution, optional?: Record<string, never>): void };
  readonly tools: { add(required: PluginToolContribution, optional?: Record<string, never>): void };
  readonly widgets: { add(required: PluginWidgetContribution, optional?: Record<string, never>): void };
  addAction(...args: never[]): void;
  addContribution(required: PluginContribution, optional?: Record<string, never>): void;
}
export interface DefinedPlugin<H extends HookPoints = HookPoints> {
  readonly definition: { setup(sdk: PluginSdk<H>): void | Promise<void> };
}

export const PLUGIN_PROVIDER_CAPABILITY = 'providers.register' as const;
export interface PluginProviderResource<T = unknown> {
  readonly port: T;
  /** Release owned resources only; borrowed effect ports remain host-owned. */
  readonly dispose: (required: Record<string, never>, optional?: Record<string, never>) => void | Promise<void>;
}
export type PluginProviderFactory = (
  required: Readonly<Record<string, unknown>>,
  optional?: Readonly<Record<string, unknown>>,
) => PluginProviderResource | Promise<PluginProviderResource>;
export interface PluginProviderContribution extends PluginProviderDeclaration {
  readonly factory: PluginProviderFactory;
}
export interface PluginProvidersSdk {
  register(required: PluginProviderContribution, optional?: Record<string, never>): void;
}


export type PluginRouteAccess = 'public' | 'member' | 'admin';
export interface PluginAuthContext { readonly access: PluginRouteAccess; readonly principalId?: string; readonly workspaceId: string }
export interface PluginInvocationContext { readonly pluginId: string; readonly auth: PluginAuthContext; readonly sdk: PluginSdk; readonly signal?: AbortSignal }
export interface PluginRouteInput extends PluginInvocationContext {
  readonly body: unknown; readonly params: Readonly<Record<string, string>>; readonly query: Readonly<Record<string, unknown>>;
}
export interface PluginRouteResult { readonly status?: number; readonly body?: unknown }
export interface PluginRouteContribution {
  readonly method: string; readonly path: string; readonly access: PluginRouteAccess;
  readonly handler: (required: PluginRouteInput, optional?: Record<string, never>) => PluginRouteResult | void | Promise<PluginRouteResult | void>;
}
/** Declared change class. Only ever tightens host policy: `destructive` forces confirmation. */
export type PluginToolEffect = 'read' | 'write' | 'destructive';
export interface PluginToolContribution {
  readonly name: string; readonly description: string; readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly effect?: PluginToolEffect;
  readonly handler: (required: PluginInvocationContext & { readonly input: unknown }, optional?: Record<string, never>) => unknown | Promise<unknown>;
}
export interface PluginWidgetContribution {
  readonly name: string;
  /** Public SSR only. Host sanitizes the bounded HTML before partial placement (ADR-025). */
  readonly render: (required: PluginInvocationContext, optional?: Record<string, never>) => string | Promise<string>;
}
export type PluginContribution = { readonly kind: 'route'; readonly value: PluginRouteContribution } | { readonly kind: 'tool'; readonly value: PluginToolContribution } | { readonly kind: 'widget'; readonly value: PluginWidgetContribution };

export interface PluginProviderDeclaration {
  readonly contract: string;
  readonly id: string;
  readonly contractVersion: 1;
  /**
   * The settings a host collects (on its own secure settings card) and passes to this provider's
   * factory as `required[name]`. Declared here, not in code, so a host can render the card and decide
   * "configured?" without executing the plugin. Secret fields are sealed by the host and never shown back.
   */
  readonly settings?: readonly PluginProviderSettingField[];
  /** Ordered read-time public-setting migrations; never rewrite persisted rows or secrets. */
  readonly settingsMigrations?: readonly PluginProviderSettingsMigration[];
}

/** A plugin-owned migration of retired public choices, applied to a copy on read. */
export interface PluginProviderSettingsMigration {
  readonly when: { readonly field: string; readonly in: readonly string[]; readonly orAbsent?: boolean };
  readonly whenPresent?: string;
  readonly set: Readonly<Record<string, string>>;
}

/** One declared provider setting; `name` is the factory input key. */
export interface PluginProviderSettingField {
  readonly name: string;
  readonly label: string;
  readonly secret?: boolean;
  readonly required?: boolean;
  /** Waive on an exact choice or a nonblank alternative. With `headerNames`, only a listed nonblank Name=Value header qualifies. */
  readonly requiredUnless?: { readonly field: string; readonly equals: string; readonly orPresent?: string; readonly headerNames?: readonly string[] };
  /** Require this field only when the controlling public setting is one of these values. */
  readonly requiredWhen?: { readonly field: string; readonly in: readonly string[] };
  readonly hint?: string;
  /** Public fields only: the value a host prefills and uses while none is saved (e.g. a vendor's cloud host). */
  readonly default?: string;
  /** Public fields only: a host renders a select of these choices instead of free text. */
  readonly options?: readonly PluginProviderSettingOption[];
  /** With `options`: also offer "Custom…" free text (e.g. a self-hosted URL). */
  readonly allowCustom?: boolean;
}

/** One choice of a {@link PluginProviderSettingField}'s `options`. */
export interface PluginProviderSettingOption {
  readonly value: string;
  readonly label: string;
}


/** Explicit plugin-authored startup guidance. Raw SDK errors must never be shown to users. */
export class PluginProviderStartupError extends Error {
  readonly reason: string;
  readonly action: string;
  constructor({ reason, action, cause }: { reason: string; action: string; cause?: unknown }, _optional = {}) {
    super(reason, { cause });
    this.name = 'PluginProviderStartupError';
    this.reason = reason;
    this.action = action;
  }
}

/** Startup guidance from a {@link PluginProviderStartupError}, matched by shape: each provider plugin
 *  artifact bundles its own copy of this class, so `instanceof` against the host's copy is always false. */
export function pluginProviderStartupGuidance({ error }: { error: unknown }, _optional = {}): { reason: string; action: string } | undefined {
  if (!(error instanceof Error) || error.name !== 'PluginProviderStartupError') return undefined;
  const { reason, action } = error as Partial<PluginProviderStartupError>;
  return typeof reason === 'string' && typeof action === 'string' ? { reason, action } : undefined;
}


/** Match only declared nonblank Name=Value headers; malformed lists never waive a requirement.
 * @complexity O(h * n) in header text and the manifest's small name allowlist. */
export function hasProviderAuthHeader({ text, names }: { text: string; names: readonly string[] }, _optional = {}): boolean {
  const pairs = text.split(',').map(pair => headerPair(pair.trim()));
  if (pairs.some(pair => !pair)) return false;
  return pairs.some(pair => names.some(name => name.toLowerCase() === pair![0].toLowerCase()) && pair![1].trim() !== '');
}

/** `[name, value]` exactly as /^([^=\s][^=]*?)\s*=\s*(.+)$/ captures them from a trimmed pair, but
 * without that pattern's backtracking: the name runs to the first `=` (trailing spaces dropped). */
function headerPair(pair: string): [string, string] | null {
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  const value = captureLineTail({ rest: pair.slice(eq + 1) });
  return value === null ? null : [pair.slice(0, eq).trimEnd(), value];
}
