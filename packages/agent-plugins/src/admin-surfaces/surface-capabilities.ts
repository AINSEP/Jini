/**
 * @file The host capability ports a plugin's admin-surface handlers receive, and the per-call
 * session that wraps them. Jini defines the shapes and the checks; the host implements the ports
 * (connections backed by its API-connection service, state by its own store, public config by its
 * own settings) and Jini never names a provider.
 *
 * Why surfaces get more than tools: account actions (connect, reconnect, switch account, disconnect)
 * and saving a chosen resource are admin actions a person takes on a settings screen, so they exist
 * here and never on the executable-tool port. Why every check sits here and not only in the host:
 * the surfaces file is the shipped, digest-checked allowlist, so the session refuses anything the
 * surface did not declare (a connection, a start parameter, a callback field, a config name) before
 * the host sees it, and a host that answers with more than the port promises (a connection ref, raw
 * scopes, undeclared callback fields) is cut back to the declared shape. Like the tool session it
 * revokes everything once the plugin is disabled and withholds results and errors that mention a
 * token the plugin obtained (in this call, an earlier one, or one of its tools); it also refuses to persist
 * such a token in plugin state.
 */
import {
  checkedStateKey, guardSharedCapabilities, guardStateReader, openCapabilityGate,
  type AgentPluginCapabilityGate, type AgentPluginStateReader, type AgentPluginStateValue, type AgentPluginToolCapabilities, type AgentPluginToolCapabilityScope,
  type IssuedTokenMemory,
} from '../lifecycle/tools/capabilities.js';
import type { AdminSurfaceCapabilityDeclarations, AdminSurfaceConnectionDeclaration } from './capability-declarations.js';
import { guardDeliveryBindings, type AdminSurfaceDeliveryBindings } from './delivery-bindings.js';
import { storedStateValue } from './settings-value.js';

// Moved to `./settings-value.ts` so delivery-binding config shares the exact checks; re-exported so callers keep importing them here.
export { ADMIN_SURFACE_STATE_LIMITS, STATE_CREDENTIAL_MESSAGE } from './settings-value.js';

/** Mirrors the API-connection lifecycle (`ApiConnectionStatus`); only `connected` serves access tokens. */
export type AdminSurfaceConnectionState = 'connected' | 'reconnect-required' | 'revocation-pending' | 'disconnected';

/**
 * The API-connection start intent each account action maps to (`ApiConnectionIntent` in
 * `@jini-ai/integrations/api-connections`, mirrored because agent-plugins does not depend on it), so a
 * host passes `ADMIN_SURFACE_ACTION_INTENTS[action]` straight to `start`. `reconnect` and `add-scopes`
 * are a same-account `connect` with the scope sets the handler passes (`add-scopes` re-consents for
 * more of them); `switch` stages another account.
 */
export const ADMIN_SURFACE_ACTION_INTENTS = Object.freeze({
  connect: 'connect', reconnect: 'connect', switch: 'switch-account', 'add-scopes': 'connect',
} as const);
export type AdminSurfaceConnectionAction = keyof typeof ADMIN_SURFACE_ACTION_INTENTS;
/**
 * The honest remote outcome of a disconnect, the same values as `ApiConnectionRemoteRevocation`:
 * never `confirmed` unless the provider confirmed it.
 */
export type AdminSurfaceRevocationOutcome = 'confirmed' | 'pending' | 'not-needed';

/** Token-free status. Scope sets are the plugin's own ids, never raw provider scopes. */
export interface AdminSurfaceConnectionStatus {
  readonly connectionId: string;
  readonly status: AdminSurfaceConnectionState;
  readonly accountLabel: string | null;
  readonly grantedScopeSetIds: readonly string[];
  /** The account a staged switch would move to, awaiting `confirmSwitch`. */
  readonly pendingSwitchAccountLabel: string | null;
  /** Why the latest sign-in did not complete and what to do next, as the HOST's own lowercase
   *  hyphenated codes (for example `access-denied` / `reconnect`), never provider text; `null` when
   *  the latest attempt succeeded or none is recorded. A value that is not a safe code becomes `null`. */
  readonly lastSignInAttempt: AdminSurfaceSignInAttempt | null;
}

/** The outcome codes of a sign-in attempt that did not complete. */
export interface AdminSurfaceSignInAttempt {
  readonly code: string;
  readonly nextAction: string;
}

/** A sign-in the person opens (a button on hosted, the system browser on desktop). */
export interface AdminSurfaceAuthorizationStart {
  readonly authorizationUrl: string;
  /** Opaque id for `takeCallbackFields` once the sign-in completed: the connection service's attempt
   *  id, never the authorization `state`. */
  readonly attemptId: string;
  readonly expiresAt: string;
}

export interface AdminSurfaceConnections {
  /** A fresh access token for one of the surface's declared connections; never a refresh token. */
  getAccessToken(required: { readonly connectionId: string }, optional?: Record<string, never>): Promise<string>;
  status(required: { readonly connectionId: string }, optional?: Record<string, never>): Promise<AdminSurfaceConnectionStatus>;
  begin(
    required: { readonly connectionId: string; readonly action: AdminSurfaceConnectionAction },
    optional?: { readonly scopeSetIds?: readonly string[]; readonly startParams?: Readonly<Record<string, string>> },
  ): Promise<AdminSurfaceAuthorizationStart>;
  confirmSwitch(required: { readonly connectionId: string }, optional?: Record<string, never>): Promise<AdminSurfaceConnectionStatus>;
  cancelSwitch(required: { readonly connectionId: string }, optional?: Record<string, never>): Promise<AdminSurfaceConnectionStatus>;
  disconnect(required: { readonly connectionId: string }, optional?: Record<string, never>): Promise<AdminSurfaceConnectionStatus & { readonly revocation: AdminSurfaceRevocationOutcome }>;
  /** The declared callback fields of a completed sign-in, once; `null` when absent, taken or not completed.
   *  Still untrusted: verify them through the provider's API before saving anything. */
  takeCallbackFields(required: { readonly connectionId: string; readonly attemptId: string }, optional?: Record<string, never>): Promise<Readonly<Record<string, string>> | null>;
}

export type AdminSurfaceStateValue = AgentPluginStateValue;

/** Plugin- and workspace-scoped JSON values (the host keys them by the session's scope). The plugin's
 *  tools read the same store through the read-only `AgentPluginStateReader`; only surfaces write. */
export interface AdminSurfaceState extends AgentPluginStateReader {
  set(required: { readonly key: string; readonly value: AdminSurfaceStateValue }, optional?: Record<string, never>): Promise<void>;
  delete(required: { readonly key: string }, optional?: Record<string, never>): Promise<void>;
}

/** Host-supplied public values (an app id, a browser key) for names the surface declares; `null` when unset. */
export interface AdminSurfacePublicConfig {
  get(required: { readonly name: string }, optional?: Record<string, never>): Promise<string | null>;
}

export type AdminSurfaceCapabilities = Pick<AgentPluginToolCapabilities, 'http' | 'limiter' | 'artifacts'> & {
  readonly connections: AdminSurfaceConnections;
  readonly state: AdminSurfaceState;
  readonly publicConfig: AdminSurfacePublicConfig;
  /** The workspace's form-delivery bindings (`./delivery-bindings.ts`). Optional for the host; a handler
   *  gets it only when its surface declares `deliveryAdapters` and the host provides it. */
  readonly deliveryBindings?: AdminSurfaceDeliveryBindings;
};

/** Host port: builds one call's capabilities for the loaded plugin, workspace and admin principal. */
export type AdminSurfaceCapabilitiesPort = (required: AgentPluginToolCapabilityScope, optional?: Record<string, never>) => AdminSurfaceCapabilities;

const ACTIONS: readonly string[] = Object.keys(ADMIN_SURFACE_ACTION_INTENTS);
const SCOPE_SET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_SCOPE_SETS = 16;
const MAX_START_PARAM_LENGTH = 2048;

/** Names in messages come from plugin code: cut them so a message stays a message. */
const named = (value: unknown) => String(value).slice(0, 64);
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

function declaredConnection(declared: readonly AdminSurfaceConnectionDeclaration[], connectionId: unknown): AdminSurfaceConnectionDeclaration {
  const found = declared.find((connection) => connection.id === connectionId);
  if (found === undefined) throw new Error(`This admin surface does not declare connection '${named(connectionId)}', so its handlers cannot use it. Declare it in the surface's connections.`);
  return found;
}

/** A copy of the start parameters, every name declared for this connection and every value a bounded string. @complexity O(p). */
function checkedStartParams(connection: AdminSurfaceConnectionDeclaration, startParams: unknown): Readonly<Record<string, string>> {
  if (!isRecord(startParams)) throw new Error('Start parameters must be an object of strings.');
  for (const [name, value] of Object.entries(startParams)) {
    if (!connection.startParams.includes(name)) throw new Error(`Start parameter '${named(name)}' is not declared for connection '${connection.id}' on this admin surface.`);
    if (typeof value !== 'string' || value.length > MAX_START_PARAM_LENGTH) throw new Error(`Start parameter '${name}' must be a string of at most ${MAX_START_PARAM_LENGTH} characters.`);
  }
  return { ...(startParams as Record<string, string>) };
}

function checkedScopeSetIds(scopeSetIds: unknown): readonly string[] {
  const valid = Array.isArray(scopeSetIds) && scopeSetIds.length <= MAX_SCOPE_SETS && scopeSetIds.every((id) => typeof id === 'string' && SCOPE_SET_ID_PATTERN.test(id));
  if (!valid) throw new Error(`Scope sets must be at most ${MAX_SCOPE_SETS} short ids.`);
  return [...(scopeSetIds as string[])];
}

/** The begin options the host receives: only the ones the handler passed, checked and copied. */
function beginOptions(connection: AdminSurfaceConnectionDeclaration, optional: Parameters<AdminSurfaceConnections['begin']>[1] = {}) {
  return {
    ...(optional.scopeSetIds !== undefined && { scopeSetIds: checkedScopeSetIds(optional.scopeSetIds) }),
    ...(optional.startParams !== undefined && { startParams: checkedStartParams(connection, optional.startParams) }),
  };
}

const SAFE_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SAFE_CODE_LENGTH = 64;
const isSafeCode = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_SAFE_CODE_LENGTH && SAFE_CODE_PATTERN.test(value);

/** Only `code` and `nextAction`, and only when both are safe codes: a host that forwarded provider
 * text (an error description) by mistake must not put it in front of the person or the plugin. */
function toSignInAttempt(attempt: unknown): AdminSurfaceSignInAttempt | null {
  if (typeof attempt !== 'object' || attempt === null) return null;
  const { code, nextAction } = attempt as Readonly<Record<string, unknown>>;
  return isSafeCode(code) && isSafeCode(nextAction) ? { code, nextAction } : null;
}

/** The status shape the port promises, whatever else the host's object carried. */
function toStatus(connectionId: string, status: AdminSurfaceConnectionStatus): AdminSurfaceConnectionStatus {
  return {
    connectionId, status: status.status, accountLabel: status.accountLabel ?? null,
    grantedScopeSetIds: [...status.grantedScopeSetIds], pendingSwitchAccountLabel: status.pendingSwitchAccountLabel ?? null,
    lastSignInAttempt: toSignInAttempt(status.lastSignInAttempt),
  };
}

/** Only this connection's declared callback fields, as strings; anything else the host returned is dropped. */
function declaredCallbackFields(connection: AdminSurfaceConnectionDeclaration, fields: Readonly<Record<string, string>> | null): Readonly<Record<string, string>> | null {
  if (fields === null) return null;
  return Object.fromEntries(connection.callbackFields.filter((name) => typeof fields[name] === 'string').map((name) => [name, fields[name]!]));
}

type ConnectionsInput = { readonly gate: AgentPluginCapabilityGate; readonly host: AdminSurfaceConnections; readonly declared: readonly AdminSurfaceConnectionDeclaration[]; readonly actorId: string | undefined };

/** Account actions run for a person; a call without one (a background route) is refused. */
function requireActor(actorId: string | undefined): void {
  if (actorId === undefined) throw new Error('Account actions need a signed-in admin. Open the surface from an authenticated admin page and retry.');
}

/**
 * A token is handed out (to a handler, and through bootstrap data to the frame) only for a signed-in
 * admin: a route without one must not mint a bearer token a frame keeps until it expires. Disabling
 * the plugin cannot recall a token already handed out; disconnecting revokes it at the provider.
 */
function requireTokenActor(actorId: string | undefined): void {
  if (actorId === undefined) throw new Error('Connection access needs a signed-in admin. Open the surface from an authenticated admin page and retry.');
}

/** The read side: a token (noted for the scans) and token-free status. */
function readConnections({ gate, host, declared, actorId }: ConnectionsInput): Pick<AdminSurfaceConnections, 'getAccessToken' | 'status' | 'takeCallbackFields'> {
  return {
    getAccessToken: gate.guard(async ({ connectionId }) => {
      const { id } = declaredConnection(declared, connectionId);
      requireTokenActor(actorId);
      return gate.noteToken({ token: await host.getAccessToken({ connectionId: id }) });
    }),
    status: gate.guard(async ({ connectionId }) => {
      const { id } = declaredConnection(declared, connectionId);
      return toStatus(id, await host.status({ connectionId: id }));
    }),
    takeCallbackFields: gate.guard(async ({ connectionId, attemptId }) => {
      const connection = declaredConnection(declared, connectionId);
      if (typeof attemptId !== 'string' || !ATTEMPT_ID_PATTERN.test(attemptId)) throw new Error('The sign-in attempt id is not valid; start the sign-in again.');
      return declaredCallbackFields(connection, await host.takeCallbackFields({ connectionId: connection.id, attemptId }));
    }),
  };
}

/** The account actions: declared connection, declared start parameters, a signed-in admin. */
function actConnections({ gate, host, declared, actorId }: ConnectionsInput): Omit<AdminSurfaceConnections, 'getAccessToken' | 'status' | 'takeCallbackFields'> {
  const forActor = (connectionId: string) => { requireActor(actorId); return declaredConnection(declared, connectionId); };
  const statusAction = (run: AdminSurfaceConnections['confirmSwitch']) => gate.guard(async ({ connectionId }: { readonly connectionId: string }) => {
    const { id } = forActor(connectionId);
    return toStatus(id, await run({ connectionId: id }));
  });
  return {
    begin: gate.guard(async ({ connectionId, action }, optional) => {
      const connection = forActor(connectionId);
      if (!ACTIONS.includes(action)) throw new Error(`Account action '${named(action)}' is not one of ${ACTIONS.join(', ')}.`);
      const started = await host.begin({ connectionId: connection.id, action }, beginOptions(connection, optional));
      return { authorizationUrl: started.authorizationUrl, attemptId: started.attemptId, expiresAt: started.expiresAt };
    }),
    confirmSwitch: statusAction((input) => host.confirmSwitch(input)),
    cancelSwitch: statusAction((input) => host.cancelSwitch(input)),
    disconnect: gate.guard(async ({ connectionId }) => {
      const { id } = forActor(connectionId);
      const outcome = await host.disconnect({ connectionId: id });
      return { ...toStatus(id, outcome), revocation: outcome.revocation };
    }),
  };
}

function guardState(gate: AgentPluginCapabilityGate, host: AdminSurfaceState): AdminSurfaceState {
  return Object.freeze({
    ...guardStateReader({ gate, state: host }),
    set: gate.guard(async ({ key, value }: { readonly key: string; readonly value: AdminSurfaceStateValue }) => host.set({ key: checkedStateKey({ key }), value: storedStateValue({ gate, value }) })),
    delete: gate.guard(({ key }: { readonly key: string }) => host.delete({ key: checkedStateKey({ key }) })),
  });
}

function guardPublicConfig(gate: AgentPluginCapabilityGate, host: AdminSurfacePublicConfig, declared: readonly string[]): AdminSurfacePublicConfig {
  return Object.freeze({
    get: gate.guard(async ({ name }: { readonly name: string }) => {
      if (!declared.includes(name)) throw new Error(`This admin surface does not declare public config '${named(name)}'. Declare it in the surface's publicConfig.`);
      return host.get({ name });
    }),
  });
}

/**
 * Opens the capability session for one admin-surface handler call.
 * @param required.capabilities - The host's ports for this call (already scoped to plugin, workspace, principal).
 * @param required.isLive - False once the plugin's surface handlers are revoked.
 * @param required.declared - The surface's own capability declarations (the allowlists).
 * @param required.issued - The plugin's token memory, shared by all its calls (tools included).
 * @param optional.actorId - The signed-in admin; account actions are refused without one.
 * @returns Wrapped capabilities plus the shared `release` (result) and `sanitize` (error) gates.
 * @complexity O(1) to open; each check is bounded by the declared lists and the value caps.
 */
export function openAdminSurfaceCapabilitySession(
  required: {
    readonly capabilities: AdminSurfaceCapabilities; readonly isLive: () => boolean; readonly declared: AdminSurfaceCapabilityDeclarations;
    readonly issued: IssuedTokenMemory;
  },
  optional: { readonly actorId?: string } = {},
) {
  const { capabilities: host, isLive, declared, issued } = required;
  const gate = openCapabilityGate({ isLive, issued });
  const input: ConnectionsInput = { gate, host: host.connections, declared: declared.connections ?? [], actorId: optional.actorId };
  const { deliveryAdapters } = declared;
  const deliveryBindings = deliveryAdapters === undefined || host.deliveryBindings === undefined ? undefined
    : guardDeliveryBindings({ gate, host: host.deliveryBindings, adapterIds: deliveryAdapters, connectionIds: input.declared.map((connection) => connection.id) }, { actorId: optional.actorId });
  const capabilities: AdminSurfaceCapabilities = Object.freeze({
    ...guardSharedCapabilities({ gate, host }),
    connections: Object.freeze({ ...readConnections(input), ...actConnections(input) }),
    state: guardState(gate, host.state),
    publicConfig: guardPublicConfig(gate, host.publicConfig, declared.publicConfig ?? []),
    ...(deliveryBindings && { deliveryBindings }),
  });
  return { capabilities, release: gate.release, sanitize: gate.sanitize };
}
