/** Executable contribution admission on the existing plugin loader, never a second loader.
 * Captures stay private until setup succeeds. A sealed generation cannot register from a timer.
 * Tier-3 currently runs with full in-process authority; TODO: hardened worker at this boundary. */
import { PLUGIN_PROVIDER_CAPABILITY, isPluginProviderDeclaration, type PluginProviderContribution } from './provider-contributions.js';
import { createContributionRegistry } from '@jini-ai/core/contribution-registry';
import { normalizeRoute, resolveClaimConflicts, type ExtensionClaim } from './claim-conflicts.js';
import type { PluginManifest } from './manifest-types.js';
import type { PluginSdk } from './ports.js';

export const PLUGIN_CONTRIBUTION_CAPABILITIES = ['http.route.register', 'tools.register', 'render.contribute', PLUGIN_PROVIDER_CAPABILITY] as const;
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
export interface PluginContributionsSnapshot {
  readonly pluginId: string; readonly sdk: PluginSdk;
  readonly providers?: readonly PluginProviderContribution[];
  readonly routes: readonly PluginRouteContribution[];
  readonly tools: readonly PluginToolContribution[];
  readonly widgets: readonly PluginWidgetContribution[];
}
/** The name used by both the claims gate and the assistant's real registry. */
export function pluginToolIdFor(required: { pluginId: string; name: string }, _optional: Record<string, never> = {}): string {
  return `p_${required.pluginId.replace(/-/g, '_')}__${required.name}`;
}
/** Relative route grammar intentionally excludes wildcard/regex routes: a handler cannot widen
 * its declared claim or leave /api/p/<id>. Express owns parameter matching. */
export function validatePluginRoute(required: { method: string; path: string }, _optional: Record<string, never> = {}): void {
  if (!/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(required.method)) throw new Error('unsupported plugin route method');
  if (!/^\/(?:[a-zA-Z0-9_-]+|:[a-zA-Z][a-zA-Z0-9_]*)(?:\/(?:[a-zA-Z0-9_-]+|:[a-zA-Z][a-zA-Z0-9_]*))*\/?$/.test(required.path) && required.path !== '/') throw new Error('unsafe plugin route path');
}

/** Enforces the object-schema contract before and after plugin-controlled JSON serialization.
 * Throws a fixed admission error. O(1) time/space. */
function requireObjectSchema({ schema }: { schema: unknown }, _options = {}): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || !('type' in schema) || schema.type !== 'object') throw new Error('plugin tool input schema must describe an object');
  return schema as Record<string, unknown>;
}

function serializePluginToolSchema(
  { schema }: { schema: Readonly<Record<string, unknown>> },
  _optional: Record<string, never> = {},
): string {
  requireObjectSchema({ schema });
  // Detach the JSON schema so later plugin mutations cannot alter the assistant contract.
  const json = JSON.stringify(schema);
  if (new TextEncoder().encode(json).byteLength > 65536) throw new Error('plugin tool schema is too large');
  return json;
}

/** Bounded registration and detached snapshots; all runtime surfaces require a manifest claim.
 * SDK capability checks remain in buildCapabilityScopedSdk; this owner checks declarations too. */
export function createPluginContributionCapture(required: { manifest: PluginManifest }, optional: { maxContributions?: number } = {}) {
  const { manifest } = required;
  const routes: PluginRouteContribution[] = [], tools: PluginToolContribution[] = [], widgets: PluginWidgetContribution[] = [];
  const providers: PluginProviderContribution[] = [];
  let sealed = false;
  const limit = optional.maxContributions ?? 128;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('invalid contribution limit');
  const check = () => {
    if (sealed) throw new Error('plugin contribution capture is sealed');
    if (routes.length + tools.length + widgets.length + providers.length >= limit) throw new Error('plugin contribution limit reached');
    // Worker proxy currently transports only beforeSave; accepting these there would lose them.
    if (manifest.tier === 'tier-2') throw new Error('worker contributions are not supported yet');
  };
  const named = (name: string, declarations: readonly string[] | undefined) => {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name) || !declarations?.includes(name)) throw new Error(`undeclared plugin contribution '${name}'`);
  };
  const capture = {
    providers: { register(value: PluginProviderContribution, _optional: Record<string, never> = {}) {
      check();
      if (manifest.tier !== 'tier-3' || !isPluginProviderDeclaration({ value }) || typeof value.factory !== 'function') throw new Error('invalid plugin provider factory');
      if (!manifest.contributes?.providers?.some(declaration => declaration.contract === value.contract && declaration.id === value.id && declaration.contractVersion === value.contractVersion)) throw new Error('undeclared plugin provider');
      if (providers.some(provider => provider.contract === value.contract && provider.id === value.id)) throw new Error('duplicate plugin provider');
      providers.push(Object.freeze({ contract: value.contract, id: value.id, contractVersion: value.contractVersion, factory: value.factory }));
    } },
    routes: { add(value: PluginRouteContribution, _optional: Record<string, never> = {}) {
      check(); validatePluginRoute(value);
      if (!['public','member','admin'].includes(value.access)) throw new Error('invalid plugin route access');
      if (typeof value.handler !== 'function') throw new Error('plugin route handler is required');
      const slot = normalizeRoute({ key: `${value.method} ${value.path}` })[0]!;
      if (!manifest.contributes?.routes?.some(key => normalizeRoute({ key }).includes(slot))) throw new Error(`undeclared plugin route '${slot}'`);
      if (routes.some(route => normalizeRoute({ key: `${route.method} ${route.path}` }).includes(slot))) throw new Error('duplicate plugin route');
      routes.push(Object.freeze({ ...value }));
    } },
    tools: { add(value: PluginToolContribution, _optional: Record<string, never> = {}) {
      check(); named(value.name, manifest.contributes?.tools);
      if (tools.some(tool => tool.name === value.name)) throw new Error('duplicate plugin tool');
      if (typeof value.handler !== 'function' || typeof value.description !== 'string' || !value.description.trim() || value.description.length > 8000) throw new Error('plugin tool handler and description are required');
      const json = serializePluginToolSchema({ schema: value.inputSchema });
      const captured = { ...value };
      const inputSchema = requireObjectSchema({ schema: JSON.parse(json) });
      tools.push(Object.freeze({ ...captured, inputSchema }));
    } },
    widgets: { add(value: PluginWidgetContribution, _optional: Record<string, never> = {}) {
      check(); named(value.name, manifest.contributes?.widgets);
      if (typeof value.render !== 'function' || widgets.some(widget => widget.name === value.name)) throw new Error('invalid or duplicate plugin widget');
      widgets.push(Object.freeze({ ...value }));
    } },
    seal({ sdk }: { sdk: PluginSdk }, _optional: Record<string, never> = {}): PluginContributionsSnapshot {
      sealed = true;
      return Object.freeze({ pluginId: manifest.id, sdk, routes: Object.freeze([...routes]), tools: Object.freeze([...tools]), widgets: Object.freeze([...widgets]), providers: Object.freeze([...providers]) });
    },
  };
  return capture;
}
export interface PluginContributionRegistry {
  replace(required: { contributions: PluginContributionsSnapshot }, optional?: Record<string, never>): void;
  detach(required: { pluginId: string }, optional?: Record<string, never>): void;
  list(required: Record<string, never>, optional?: Record<string, never>): readonly PluginContributionsSnapshot[];
  subscribe(required: { onChanged: () => void }, optional?: Record<string, never>): () => void;
}
/** Reuses core's contribution owner and the existing conflict detector. Replacement and detach
 * rebuild a small plugin collection atomically; readers always see complete generations. */
export function createPluginContributionRegistry(_required: Record<string, never>, _optional: Record<string, never> = {}): PluginContributionRegistry {
  const registry = createContributionRegistry<PluginContributionsSnapshot, string>({ keyOf: ({ contribution }) => contribution.pluginId });
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    subscribe({ onChanged }) { listeners.add(onChanged); return () => { listeners.delete(onChanged); }; },
    replace({ contributions }) {
      const next = [...registry.list({}).filter(row => row.pluginId !== contributions.pluginId), contributions];
      const owners = next.map(row => ({ id: row.pluginId, claims: [
        ...row.tools.map(tool => ({ kind: 'tool', key: pluginToolIdFor({ pluginId: row.pluginId, name: tool.name }), mode: 'exclusive' } as ExtensionClaim)),
        ...row.widgets.map(widget => ({ kind: 'widget', key: widget.name, mode: 'exclusive' } as ExtensionClaim)),
        // Provider identity is exclusive within one contract; the same claim key as plugin-claims.ts.
        ...(row.providers ?? []).map(provider => ({ kind: 'provider', key: `${provider.contract}:${provider.id}`, mode: 'exclusive' } as ExtensionClaim)),
      ] }));
      if (resolveClaimConflicts({ owners }).refused.size) throw new Error('plugin contribution collision');
      const previous = registry.list({});
      registry.register({ contribution: contributions });
      try { notify(); } catch (error) {
        registry.clear({});
        for (const contribution of previous) registry.register({ contribution });
        notify();
        throw error;
      }
    },
    detach({ pluginId }) {
      const retained = registry.list({}).filter(row => row.pluginId !== pluginId);
      registry.clear({});
      for (const contribution of retained) registry.register({ contribution });
      notify();
    },
    list: (input) => registry.list(input),
  };
}

/** Resolves only named public fragments, isolating failures and bounding the awaited work.
 * Validation is an injected host renderer port; plugins cannot substitute their own validator.
 * TODO: client enhancement JS waits for an ADR-025 owner amendment. */
export async function renderPluginWidgetFragments(required: {
  registry: PluginContributionRegistry; names: readonly string[]; workspaceId: string;
  isEnabled: (required: { pluginId: string }, optional?: Record<string, never>) => Promise<boolean>;
  validateHtml: (required: { html: string }, optional?: Record<string, never>) => string;
}, optional: { timeoutMs?: number; maxNames?: number; onError?: (required: { pluginId: string; widgetName: string; error: unknown }, optional?: Record<string, never>) => void } = {}): Promise<Readonly<Record<string, string>>> {
  const names = [...new Set(required.names)];
  if (names.length > (optional.maxNames ?? 32)) throw new Error('too many plugin widget placements');
  const timeoutMs = optional.timeoutMs ?? 2000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new RangeError('invalid widget timeout');
  const fragments: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const snapshot of required.registry.list({})) {
    const selected = snapshot.widgets.filter(widget => names.includes(widget.name));
    if (!selected.length) continue;
    if (!await required.isEnabled({ pluginId: snapshot.pluginId })) continue;
    await Promise.all(selected.map(async widget => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const controller = new AbortController();
      try {
        const html = await Promise.race([
          Promise.resolve().then(() => widget.render({ pluginId: snapshot.pluginId, sdk: snapshot.sdk, auth: { access: 'public', workspaceId: required.workspaceId }, signal: controller.signal }, {})),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('widget timeout')); }, timeoutMs); }),
        ]);
        if (typeof html !== 'string' || !required.registry.list({}).includes(snapshot) || !await required.isEnabled({ pluginId: snapshot.pluginId })) return;
        fragments[widget.name] = required.validateHtml({ html });
      } catch (error) {
        (optional.onError ?? ((failure) => console.warn(`[plugins] Plugin '${failure.pluginId}' widget '${failure.widgetName}' failed`, failure.error)))({ pluginId: snapshot.pluginId, widgetName: widget.name, error }, {});
        fragments[widget.name] = '';
      } finally { if (timer !== undefined) clearTimeout(timer); }
    }));
  }
  return fragments;
}
