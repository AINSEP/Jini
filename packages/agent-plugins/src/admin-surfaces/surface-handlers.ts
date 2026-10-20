/**
 * @file Plugin-supplied server-side handlers for admin surfaces: a surface may name a contained
 * `.mjs` `handlerModule` that answers its declared actions and may provide its bootstrap data.
 *
 * Why it exists: without it a host can only answer a surface's actions with its own code, so a
 * provider plugin cannot ship a working settings or picker screen. Why it is safe to run plugin code
 * here: the module loads only through the lifecycle's one executable loader
 * (`defineExecutablePluginContribution`: active plugin, shipped digest, on-disk containment), it
 * receives the same host capability ports as an executable tool (never a raw secret), every call goes
 * through G4's capability session (revoked on disable, results and errors scanned for tokens the call
 * obtained), and the dispatcher still checks the declared input and result schemas around it.
 * Bootstrap data is the one answer allowed to carry an access token (a surface may need a short-lived
 * one); it must match the surface's declared `bootstrap` schema and is never cached by the host.
 */
import { defineExecutablePluginContribution, type LoadedPluginContribution, type PluginContributionDefinition } from '../lifecycle/contribution-loader.js';
import { openCapabilitySession, type AgentPluginToolCapabilities, type AgentPluginToolCapabilitiesPort } from '../lifecycle/tools/capabilities.js';
import { AdminSurfaceActionError, type AdminSurfaceActionHandler } from './action-dispatcher.js';
import { validateAdminSurfaceActionValue, type AdminSurfaceActionSchema } from './action-schema.js';
import { parseAdminSurfacesFile, type AdminSurfaceDescriptor } from './descriptor.js';

/** Who a call is for. The host route establishes it; plugin and surface ids are rebound to the
 * loaded module's own before a handler sees them. */
export interface AdminSurfaceHandlerContext {
  readonly workspaceId: string;
  readonly principalId?: string;
  readonly pluginId: string;
  readonly surfaceId: string;
}

/** What a bootstrap provider receives. */
export interface AdminSurfaceBootstrapCall {
  readonly capabilities: AgentPluginToolCapabilities;
  readonly context: AdminSurfaceHandlerContext;
}

/** What an action handler receives. `input` already matched the action's declared input schema. */
export interface AdminSurfaceHandlerCall extends AdminSurfaceBootstrapCall {
  readonly input: unknown;
  /** Builds a surface-safe failure to throw: `code` (lowercase hyphenated) and `message` reach the frame. */
  readonly fail: (required: { readonly code: string; readonly message: string }, optional?: { readonly retryable?: boolean }) => Error;
}

/** What a handler module's default export must be. */
export interface AdminSurfaceHandlerModule {
  /** Keyed by declared action name; a declared action without one answers `action-unavailable`. */
  readonly actions: Readonly<Record<string, (required: AdminSurfaceHandlerCall, optional?: Record<string, never>) => unknown>>;
  /** Data the surface starts with; requires a `bootstrap` schema on the surface. */
  readonly bootstrap?: (required: AdminSurfaceBootstrapCall, optional?: Record<string, never>) => unknown;
}

type HandledSurface = AdminSurfaceDescriptor & { readonly handlerModule: string };
export type LoadedAdminSurfaceHandlers = LoadedPluginContribution<HandledSurface, AdminSurfaceHandlerModule>;

export const ADMIN_SURFACE_PLUGIN_DISABLED_MESSAGE = 'This plugin was disabled, so its admin surface cannot act. Re-enable the plugin and reopen the surface.';
const FAILURE_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_FAILURE_CODE_LENGTH = 64;
const MAX_FAILURE_MESSAGE_LENGTH = 300;

const isFunction = (value: unknown) => typeof value === 'function';
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The module's export as a handler module, or why not. Shape only; declarations are checked at sync. @complexity O(a) exported actions. */
function validateHandlerModule({ exported }: { readonly exported: unknown }): AdminSurfaceHandlerModule | string {
  if (!isRecord(exported)) return "its module's default export is not an object";
  if (!isRecord(exported.actions) || !Object.values(exported.actions).every(isFunction)) return "its module's default export needs an actions object of functions";
  if (exported.bootstrap !== undefined && !isFunction(exported.bootstrap)) return 'bootstrap must be a function';
  return exported as unknown as AdminSurfaceHandlerModule;
}

/**
 * The executable contribution for the host's surfaces file (the same file `defineAdminSurfaceContribution`
 * reads): one item per surface that names a `handlerModule`.
 * @param required.filename - The host-named surfaces file at the plugin root.
 * @complexity O(1); each load parses the file and performs one contained import per handled surface.
 */
export function defineAdminSurfaceHandlerContribution(
  required: { readonly filename: string },
  _optional: Record<string, never> = {},
): PluginContributionDefinition<HandledSurface, LoadedAdminSurfaceHandlers> {
  return defineExecutablePluginContribution<HandledSurface, AdminSurfaceHandlerModule>({
    filename: required.filename, contribution: 'admin surface handlers',
    parse: ({ raw }) => {
      const parsed = parseAdminSurfacesFile({ raw });
      return parsed.ok ? { ok: true, descriptors: parsed.descriptors.filter((descriptor): descriptor is HandledSurface => descriptor.handlerModule !== undefined) } : parsed;
    },
    modulePath: ({ descriptor }) => descriptor.handlerModule, validate: validateHandlerModule,
    refusal: ({ plugin, descriptor, reason }) => `admin surface handlers for '${descriptor.id}' from '${plugin.pluginId}' were not loaded: ${reason}`,
  });
}

/** A surface-safe failure, or a generic one when the plugin's code is not a valid id. @complexity O(1). */
function fail(required: { readonly code: string; readonly message: string }, optional: { readonly retryable?: boolean } = {}): Error {
  const { code, message } = required;
  if (typeof code !== 'string' || code.length > MAX_FAILURE_CODE_LENGTH || !FAILURE_CODE_PATTERN.test(code)) return new Error('a plugin failure used an invalid code');
  return new AdminSurfaceActionError({ code, message: String(message).slice(0, MAX_FAILURE_MESSAGE_LENGTH) }, { retryable: optional.retryable === true });
}

/** Why a loaded module cannot answer for its surface, or null. @complexity O(a) exported actions. */
function admissionRefusal({ descriptor, module }: LoadedAdminSurfaceHandlers): string | null {
  const undeclared = Object.keys(module.actions).find((name) => !descriptor.actions.some((action) => action.name === name));
  if (undeclared !== undefined) return `it exports a handler for undeclared action '${undeclared.slice(0, 64)}'`;
  return module.bootstrap !== undefined && descriptor.bootstrap === undefined ? 'it exports bootstrap() but the surface declares no bootstrap schema' : null;
}

interface AdmittedSurface {
  readonly loaded: LoadedAdminSurfaceHandlers;
  readonly handlers: Readonly<Record<string, AdminSurfaceActionHandler<AdminSurfaceHandlerContext>>>;
  readonly isLive: () => boolean;
}

/** Plugin and surface ids cannot contain NUL, so the key is unambiguous. */
const keyOf = (pluginId: string, surfaceId: string) => `${pluginId}\u0000${surfaceId}`;

/**
 * Holds the admitted handler modules and answers for them. Call `sync` with every load of
 * `defineAdminSurfaceHandlerContribution` (on boot and on every activation change); a surface missing
 * from a load loses its handlers, and capabilities its module kept are revoked.
 * @param required.capabilities - Host port building one call's capabilities (the executable-tool port shape).
 * @returns `sync`, plus `handlersFor` and `bootstrapData` for the host's action dispatcher and bootstrap route.
 * @complexity sync is O(s + a) surfaces and actions; lookups are O(1).
 */
export function createAdminSurfaceHandlerHost(required: { readonly capabilities: AgentPluginToolCapabilitiesPort }, _optional: Record<string, never> = {}) {
  let admitted = new Map<string, AdmittedSurface>();

  /** One call's capability session, scoped to the loaded plugin and the route's workspace/principal. */
  function sessionFor(self: AdmittedSurface, context: AdminSurfaceHandlerContext) {
    const { pluginId, descriptor } = self.loaded;
    const principal = context.principalId === undefined ? {} : { principalId: context.principalId };
    const session = openCapabilitySession({ capabilities: required.capabilities({ pluginId, workspaceId: context.workspaceId, ...principal }), isLive: self.isLive });
    return { session, context: { workspaceId: context.workspaceId, ...principal, pluginId, surfaceId: descriptor.id } };
  }

  function actionHandler(self: AdmittedSurface, run: AdminSurfaceHandlerModule['actions'][string]): AdminSurfaceActionHandler<AdminSurfaceHandlerContext> {
    return async ({ payload, context: caller }) => {
      if (!self.isLive()) throw new AdminSurfaceActionError({ code: 'plugin-disabled', message: ADMIN_SURFACE_PLUGIN_DISABLED_MESSAGE });
      const { session, context } = sessionFor(self, caller);
      try { return session.release({ value: await run({ input: payload, capabilities: session.capabilities, context, fail }) }); }
      catch (error) { throw session.sanitize({ error }); }
    };
  }

  /** A generation for one surface; live only while `admitted` holds this exact object. */
  function admit(key: string, loaded: LoadedAdminSurfaceHandlers): AdmittedSurface {
    const declared = loaded.descriptor.actions.filter((action) => Object.hasOwn(loaded.module.actions, action.name));
    const self: AdmittedSurface = { loaded, handlers: {}, isLive: () => admitted.get(key) === self };
    Object.assign(self.handlers, Object.fromEntries(declared.map((action) => [action.name, actionHandler(self, loaded.module.actions[action.name]!)])));
    return Object.freeze(self);
  }

  /** The previous generation when module and declaration are unchanged, so re-syncing never revokes it. */
  function unchanged(previous: AdmittedSurface | undefined, loaded: LoadedAdminSurfaceHandlers): AdmittedSurface | undefined {
    const same = previous !== undefined && previous.loaded.module === loaded.module && JSON.stringify(previous.loaded.descriptor) === JSON.stringify(loaded.descriptor);
    return same ? previous : undefined;
  }

  return {
    /** Admits one load result. @returns The loader's refusals plus this seam's own, in order. */
    sync(input: { readonly loaded: readonly LoadedAdminSurfaceHandlers[]; readonly refusals: readonly string[] }, _options: Record<string, never> = {}): { readonly refusals: readonly string[] } {
      const refusals = [...input.refusals];
      const claims = new Map<string, number>();
      for (const entry of input.loaded) claims.set(keyOf(entry.pluginId, entry.descriptor.id), (claims.get(keyOf(entry.pluginId, entry.descriptor.id)) ?? 0) + 1);
      const next = new Map<string, AdmittedSurface>();
      const previous = admitted;
      for (const entry of input.loaded) {
        const key = keyOf(entry.pluginId, entry.descriptor.id);
        const reason = claims.get(key)! > 1 ? 'more than one handler module claims this surface' : admissionRefusal(entry);
        const line = `admin surface handlers for '${entry.descriptor.id}' from '${entry.pluginId}' were not loaded: ${reason}`;
        if (reason !== null) { if (!refusals.includes(line)) refusals.push(line); continue; }
        next.set(key, unchanged(previous.get(key), entry) ?? admit(key, entry));
      }
      admitted = next;
      return { refusals };
    },
    /** The plugin's handlers for one surface (empty when none are admitted), for `createAdminSurfaceActionDispatcher`. */
    handlersFor(input: { readonly pluginId: string; readonly surfaceId: string }, _options: Record<string, never> = {}): Readonly<Record<string, AdminSurfaceActionHandler<AdminSurfaceHandlerContext>>> {
      return admitted.get(keyOf(input.pluginId, input.surfaceId))?.handlers ?? {};
    },
    /** The plugin's bootstrap data for `context`'s surface, or null when it provides none.
     * @throws Error when the data does not match the declared schema (the message names a path, never a value). */
    async bootstrapData(input: { readonly context: AdminSurfaceHandlerContext }, _options: Record<string, never> = {}): Promise<unknown> {
      const self = admitted.get(keyOf(input.context.pluginId, input.context.surfaceId));
      const provide = self?.loaded.module.bootstrap;
      if (self === undefined || provide === undefined) return null;
      const { session, context } = sessionFor(self, input.context);
      let data: unknown;
      try { data = await provide({ capabilities: session.capabilities, context }); } catch (error) { throw session.sanitize({ error }); }
      // Admission guarantees a schema whenever the module provides bootstrap data.
      const violation = validateAdminSurfaceActionValue({ schema: self.loaded.descriptor.bootstrap as AdminSurfaceActionSchema, value: data });
      if (violation !== null) throw new Error(`Admin surface '${context.surfaceId}' from '${context.pluginId}' returned bootstrap data outside its declared schema (${violation}); report it to the plugin author.`);
      return data;
    },
  };
}
