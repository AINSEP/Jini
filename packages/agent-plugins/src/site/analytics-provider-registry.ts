import path from "node:path";

import type { ProviderRegistry } from "@jini-ai/core/provider-registry";
import {
  contributeProviders, defineProviderContribution, type LoadedProviderContribution, type PluginContributionDefinition, type PluginContributionResult,
} from "@jini-ai/agent-plugins/lifecycle";

/**
 * @file Loads the analytics providers Agent Plugins contribute: vendor FORWARDERS (Plausible /
 * PostHog / GA4-style, selected per site by `core.analytics.sink`) and `beforeIngest` HOOKS. The
 * generic seam that lets a plugin add a vendor without core naming one — same trust gate as mail
 * adapters (`mail-adapter-registry.ts`): a module runs in this process, so it loads only from an
 * ACTIVE plugin whose installed digest is a bundled one, from a contained `.mjs` path. A bad plugin
 * drops only its own providers and every drop is a refusal line, never a throw.
 *
 * Manifests are data-only: `{ schemaVersion: 1, providers: [{ id, module, label? }] }`. A
 * forwarder module's default export is an `AnalyticsForwarderModule` (it may declare its own
 * `credentialLabel`); a hook module's default export has `beforeIngest({ hit })`.
 *
 * The host injects the analytics package's contracts, validators and forwarder-registry factory plus
 * its own product-named manifest filenames (see `README.md` `## Wiring`), so this file names no vendor.
 */

export interface AnalyticsProviderDescriptor {
  readonly id: string;
  /** Plugin-relative path of the `.mjs` module. */
  readonly module: string;
  readonly label?: string;
}

type ParseResult = { readonly ok: true; readonly descriptors: readonly AnalyticsProviderDescriptor[] } | { readonly ok: false; readonly reason: string };

const MAX_LABEL_LENGTH = 100;

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One descriptor entry, or why it is invalid. The id grammar is the registry's (checked before import). @complexity O(1). */
function parseDescriptor({ entry, at }: { entry: unknown; at: string }, _optional: Record<string, never> = {}): AnalyticsProviderDescriptor | string {
  if (!isPlainObject(entry)) return `${at} must be an object`;
  const { id, module, label } = entry;
  if (typeof id !== "string") return `${at}.id must be a string`;
  if (!isRelativeModulePath(module)) return `${at}.module must be a relative path ending in .mjs`;
  if (label === undefined) return { id, module };
  if (typeof label !== "string" || label.trim() === "" || label.length > MAX_LABEL_LENGTH) return `${at}.label must be a non-empty string`;
  return { id, module, label };
}

function isRelativeModulePath(module: unknown): module is string {
  return typeof module === "string" && module.endsWith(".mjs") && !path.posix.isAbsolute(module);
}

/**
 * Parses an analytics provider manifest. Pure; unknown keys are ignored.
 * @complexity O(p) declared providers.
 */
export function parseAnalyticsProvidersFile(required: { readonly raw: string }, _optional: Record<string, never> = {}): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(required.raw);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (!isPlainObject(value) || value.schemaVersion !== 1) return { ok: false, reason: "schemaVersion must be 1" };
  if (!Array.isArray(value.providers)) return { ok: false, reason: "providers must be an array" };
  const descriptors: AnalyticsProviderDescriptor[] = [];
  for (const [index, entry] of value.providers.entries()) {
    const result = parseDescriptor({ entry, at: `providers[${index}]` });
    if (typeof result === "string") return { ok: false, reason: result };
    if (descriptors.some((seen) => seen.id === result.id)) return { ok: false, reason: `providers[${index}].id '${result.id}' is declared twice` };
    descriptors.push(result);
  }
  return { ok: true, descriptors };
}

/** One injected provider kind (forwarders or hooks): the analytics package's contract and validator, the host's filename. */
export interface AnalyticsProviderKind<T> {
  /** Registry contract this kind contributes to (the analytics package's contract constant). */
  readonly contract: string;
  /** The host-named file a plugin ships at its root to contribute this kind. */
  readonly filename: string;
  /** The module export as this kind's provider, or why not (the analytics package's validator). */
  readonly validate: (required: { readonly exported: unknown }) => T | string;
}

/** The host's contribution loader, bound to its lifecycle owner's trust gate. */
export type AnalyticsContributionLoader = <D, T>(
  input: { readonly workspaceId: string; readonly definition: PluginContributionDefinition<D, T> },
  optional: { readonly orderByPluginId: boolean },
) => Promise<PluginContributionResult<T>>;

/** Every collaborator `loadAnalyticsProviders` needs; `F` is the forwarder module, `H` the hook. */
export interface AnalyticsProviderPorts<F, H> {
  readonly forwarders: AnalyticsProviderKind<F>;
  readonly hooks: AnalyticsProviderKind<H>;
  /** A fresh keyed forwarder registry (the analytics package's factory). */
  readonly createForwarderRegistry: () => ProviderRegistry<NoInfer<F>>;
}

/**
 * Per-plugin recovery: an unreadable manifest or a module that throws on import is that plugin's
 * refusal line, so one broken plugin never discards the healthy forwarders and hooks beside it.
 */
const recovery = (required: { readonly noun: string; readonly filename: string }) => ({
  onReadError: ({ plugin }: { readonly plugin: { readonly pluginId: string } }) =>
    [`analytics ${required.noun} from '${plugin.pluginId}' were not loaded: ${required.filename} could not be read`],
  importErrorReason: "its module failed to load",
});

/** The shared provider-contribution definition for one injected kind. @complexity O(1). */
export function analyticsProviderContribution<T>(
  required: { readonly kind: AnalyticsProviderKind<T>; readonly noun: string },
  _optional: Record<string, never> = {},
): PluginContributionDefinition<AnalyticsProviderDescriptor, LoadedProviderContribution<T>> {
  const { contract, filename, validate } = required.kind;
  return defineProviderContribution<AnalyticsProviderDescriptor, T>({
    contract, filename, parse: ({ raw }) => parseAnalyticsProvidersFile({ raw }),
    validate: ({ exported }) => validate({ exported }),
  }, recovery({ noun: required.noun, filename }));
}

export interface AnalyticsProviders<F, H> {
  /** Keyed vendor forwarders; `core.analytics.sink` selects one per site. */
  readonly forwarders: ProviderRegistry<F>;
  /** `beforeIngest` handlers in a stable order (plugin id, then declaration order). */
  readonly hooks: readonly H[];
  /** Log-safe, one sentence per provider or plugin that was NOT loaded, and why. */
  readonly refusals: readonly string[];
}

/**
 * Builds this workspace's analytics providers from its installed Agent Plugins.
 * @throws Nothing for a plugin-level fault; only a fault listing the package directory itself.
 * @complexity O(p) installed plugins: two small reads plus one import per declared provider.
 */
export async function loadAnalyticsProviders<F, H>(
  ctx: { readonly workspaceId: string },
  required: { readonly loadContributions: AnalyticsContributionLoader; readonly analytics: AnalyticsProviderPorts<F, H> },
): Promise<AnalyticsProviders<F, H>> {
  const { analytics } = required;
  const [forwarderLoad, hookLoad] = await Promise.all([
    required.loadContributions({ ...ctx, definition: analyticsProviderContribution({ kind: analytics.forwarders, noun: "forwarders" }) }, { orderByPluginId: true }),
    required.loadContributions({ ...ctx, definition: analyticsProviderContribution({ kind: analytics.hooks, noun: "hooks" }) }, { orderByPluginId: true }),
  ]);
  const forwarders = analytics.createForwarderRegistry();
  const contributed = contributeProviders({ registry: forwarders, loaded: forwarderLoad });
  return {
    forwarders,
    hooks: hookLoad.items.map((item) => item.definition.provider),
    refusals: [...contributed.refusals, ...hookLoad.refusals],
  };
}
