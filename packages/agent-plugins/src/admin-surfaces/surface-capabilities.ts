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
 * token the call obtained; it also refuses to persist such a token in plugin state.
 */
import {
  checkedStateKey, guardSharedCapabilities, guardStateReader, openCapabilityGate, PLUGIN_STATE_MAX_KEY_LENGTH,
  type AgentPluginCapabilityGate, type AgentPluginStateReader, type AgentPluginStateValue, type AgentPluginToolCapabilities, type AgentPluginToolCapabilityScope,
} from '../lifecycle/tools/capabilities.js';
import type { AdminSurfaceCapabilityDeclarations, AdminSurfaceConnectionDeclaration } from './capability-declarations.js';

/** Mirrors the API-connection lifecycle; only `connected` serves access tokens. */
export type AdminSurfaceConnectionState = 'connected' | 'reconnect-required' | 'revocation-pending' | 'disconnected';
/** `add-scopes` re-consents for more scope sets on the same account; `switch` stages another account. */
export type AdminSurfaceConnectionAction = 'connect' | 'reconnect' | 'switch' | 'add-scopes';
/** The honest remote outcome of a disconnect: never `revoked` unless the provider confirmed it. */
export type AdminSurfaceRevocationOutcome = 'revoked' | 'revocation-pending' | 'not-needed';

/** Token-free status. Scope sets are the plugin's own ids, never raw provider scopes. */
export interface AdminSurfaceConnectionStatus {
  readonly connectionId: string;
  readonly state: AdminSurfaceConnectionState;
  readonly accountLabel: string | null;
  readonly grantedScopeSetIds: readonly string[];
  /** The account a staged switch would move to, awaiting `confirmSwitch`. */
  readonly pendingSwitchAccountLabel: string | null;
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
};

/** Host port: builds one call's capabilities for the loaded plugin, workspace and admin principal. */
export type AdminSurfaceCapabilitiesPort = (required: AgentPluginToolCapabilityScope, optional?: Record<string, never>) => AdminSurfaceCapabilities;

export const ADMIN_SURFACE_STATE_LIMITS = Object.freeze({ maxKeyLength: PLUGIN_STATE_MAX_KEY_LENGTH, maxValueBytes: 16 * 1024, maxDepth: 16 });
export const STATE_CREDENTIAL_MESSAGE = 'The plugin tried to save a connection credential in its settings; nothing was saved.';
const ACTIONS: readonly string[] = ['connect', 'reconnect', 'switch', 'add-scopes'];
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

/** The status shape the port promises, whatever else the host's object carried. */
function toStatus(connectionId: string, status: AdminSurfaceConnectionStatus): AdminSurfaceConnectionStatus {
  return {
    connectionId, state: status.state, accountLabel: status.accountLabel ?? null,
    grantedScopeSetIds: [...status.grantedScopeSetIds], pendingSwitchAccountLabel: status.pendingSwitchAccountLabel ?? null,
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

/** The read side: a token (noted for the scans) and token-free status. */
function readConnections({ gate, host, declared }: ConnectionsInput): Pick<AdminSurfaceConnections, 'getAccessToken' | 'status' | 'takeCallbackFields'> {
  return {
    getAccessToken: gate.guard(async ({ connectionId }) => gate.noteToken({ token: await host.getAccessToken({ connectionId: declaredConnection(declared, connectionId).id }) })),
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

function isStateScalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/** True for plain JSON data only: no undefined, functions, NaN, class instances or deep nesting. @complexity O(n) nodes. */
function isStateValue(value: unknown, depth: number): boolean {
  if (isStateScalar(value)) return true;
  if (typeof value !== 'object' || depth >= ADMIN_SURFACE_STATE_LIMITS.maxDepth) return false;
  if (Array.isArray(value)) return value.every((item) => isStateValue(item, depth + 1));
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Object.values(value as object).every((item) => isStateValue(item, depth + 1));
}

/**
 * The value the host stores: serialized once, scanned and size-checked on that text, then parsed
 * back, so what is stored is exactly what was checked (the plugin cannot change it afterwards).
 * @complexity O(n) in the serialized size.
 */
function storedStateValue(gate: AgentPluginCapabilityGate, value: unknown): AdminSurfaceStateValue {
  if (!isStateValue(value, 0)) throw new Error('A settings value must be plain JSON data (no undefined, functions, NaN or class instances).');
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > ADMIN_SURFACE_STATE_LIMITS.maxValueBytes) throw new Error(`A settings value may be at most ${ADMIN_SURFACE_STATE_LIMITS.maxValueBytes} bytes of JSON.`);
  if (gate.mentionsToken({ value: text })) throw new Error(STATE_CREDENTIAL_MESSAGE);
  return JSON.parse(text) as AdminSurfaceStateValue;
}

function guardState(gate: AgentPluginCapabilityGate, host: AdminSurfaceState): AdminSurfaceState {
  return Object.freeze({
    ...guardStateReader({ gate, state: host }),
    set: gate.guard(async ({ key, value }: { readonly key: string; readonly value: AdminSurfaceStateValue }) => host.set({ key: checkedStateKey({ key }), value: storedStateValue(gate, value) })),
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
 * @param optional.actorId - The signed-in admin; account actions are refused without one.
 * @returns Wrapped capabilities plus the shared `release` (result) and `sanitize` (error) gates.
 * @complexity O(1) to open; each check is bounded by the declared lists and the value caps.
 */
export function openAdminSurfaceCapabilitySession(
  required: { readonly capabilities: AdminSurfaceCapabilities; readonly isLive: () => boolean; readonly declared: AdminSurfaceCapabilityDeclarations },
  optional: { readonly actorId?: string } = {},
) {
  const { capabilities: host, isLive, declared } = required;
  const gate = openCapabilityGate({ isLive });
  const input: ConnectionsInput = { gate, host: host.connections, declared: declared.connections ?? [], actorId: optional.actorId };
  const capabilities: AdminSurfaceCapabilities = Object.freeze({
    ...guardSharedCapabilities({ gate, host }),
    connections: Object.freeze({ ...readConnections(input), ...actConnections(input) }),
    state: guardState(gate, host.state),
    publicConfig: guardPublicConfig(gate, host.publicConfig, declared.publicConfig ?? []),
  });
  return { capabilities, release: gate.release, sanitize: gate.sanitize };
}
