/**
 * @file Agent Plugin admin-surface contracts. Additive copy of the type declarations in
 * `@jini-ai/agent-plugins/admin-surfaces` (`protocol.ts`, `descriptor.ts`, `plugin-state.ts`,
 * `plugin-state-persistence.ts`, `surface-capabilities.ts`) and the structural closure they read
 * (`../contracts/admin-surface-action-schema.ts`, `../lifecycle/tools/{manifest,capabilities}.ts`);
 * that package keeps its identical declarations, its runtime values and its exports until the
 * paired cutover.
 */
import type { VaultContext, VaultIdentity, VaultMeta, VaultSummary } from "../vault.js";

/**
 * A deliberately small, closed subset of JSON Schema for admin-surface action inputs and results:
 * checked once when the descriptor is parsed, then used to validate every payload.
 *
 * Why not full JSON Schema: a surface's payload crosses a trust boundary (plugin UI -> host
 * handler), so the schema language is fail-closed. An unknown keyword refuses the descriptor
 * instead of being ignored (a plugin cannot rely on `pattern` or `format` that would silently pass),
 * objects are closed (no undeclared keys reach a handler), and every node must name its `type`.
 * Violation messages name the path only, never the value, so a rejected payload cannot echo a secret.
 */
export type AdminSurfaceActionSchema =
  | { readonly type: 'object'; readonly properties?: Readonly<Record<string, AdminSurfaceActionSchema>>; readonly required?: readonly string[]; readonly additionalProperties?: false }
  | { readonly type: 'array'; readonly items: AdminSurfaceActionSchema; readonly maxItems?: number }
  | { readonly type: 'string'; readonly minLength?: number; readonly maxLength?: number; readonly enum?: readonly string[] }
  | { readonly type: 'number' | 'integer'; readonly minimum?: number; readonly maximum?: number }
  | { readonly type: 'boolean' | 'null' };

/**
 * Declared change class; `write` and `destructive` tools must also disclose affected resources.
 * The mirror of `PluginToolEffect` in `@jini-ai/plugins/host` (agent-plugins may not import it).
 */
export type AgentPluginToolEffect = 'read' | 'write' | 'destructive';

/** Short-lived data the host server issues for one surface render (e.g. a scoped access token plus
 * public config). Never cached (see `adminSurfaceBootstrapHeaders`), refused once `expiresAt` passes. */
export interface AdminSurfaceBootstrap<D = unknown> {
  readonly surfaceId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly data: D;
}

/** Surface-safe failure: `message` is written for the person using the surface and never carries a
 * handler's raw error text, a token or a submitted value. */
export interface AdminSurfaceActionFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type AdminSurfaceActionOutcome =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: AdminSurfaceActionFailure };

export interface AdminSurfaceAction {
  readonly name: string;
  /** Assistant confirmation class; omitted declarations are writes. */
  readonly effect?: AgentPluginToolEffect;
  readonly input: AdminSurfaceActionSchema;
  /** When declared, the dispatcher refuses a handler result that does not conform. */
  readonly result?: AdminSurfaceActionSchema;
}

/** @agent-note Back it with the same vault object as your API connection host; `format` and the row ids are saved; never change them. */
export interface AdminSurfacePluginStatePersistence {
  readonly scope: VaultContext;
  readonly format: string;
  readonly vault: {
    list(required: VaultContext): Promise<readonly VaultSummary[]>;
    get(required: VaultIdentity): Promise<{ summary: VaultSummary; payload: VaultMeta | null } | null>;
    put(required: VaultIdentity & { expectedRevision: number | null; provider: null; label: string; meta: VaultMeta; payload: VaultMeta }): Promise<VaultSummary>;
    delete(required: VaultIdentity & { expectedRevision: number }): Promise<boolean>;
  };
  isConflict(required: { error: unknown }): boolean;
}

/** Plain JSON a plugin keeps in its plugin- and workspace-scoped state. */
export type AgentPluginStateValue = null | boolean | number | string | readonly AgentPluginStateValue[] | { readonly [key: string]: AgentPluginStateValue };

/**
 * The read-only view of a plugin's own state: what its tools get, and what a host hands any other
 * plugin execution context (form delivery, for example) that must honor the plugin's settings. A
 * host handing it elsewhere passes an object with `get` only, never its whole store.
 */
export interface AgentPluginStateReader {
  get(required: { readonly key: string }, optional?: Record<string, never>): Promise<AgentPluginStateValue | null>;
}

export type AdminSurfaceStateValue = AgentPluginStateValue;

/** Plugin- and workspace-scoped JSON values (the host keys them by the session's scope). The plugin's
 *  tools read the same store through the read-only `AgentPluginStateReader`; only surfaces write. */
export interface AdminSurfaceState extends AgentPluginStateReader {
  set(required: { readonly key: string; readonly value: AdminSurfaceStateValue }, optional?: Record<string, never>): Promise<void>;
  delete(required: { readonly key: string }, optional?: Record<string, never>): Promise<void>;
}

export interface AgentPluginStateScope {
  readonly workspaceId: string;
  readonly pluginId: string;
}

export interface AgentPluginStateStore {
  /** Read-write view for the plugin's admin-surface handlers. */
  forPlugin(required: AgentPluginStateScope, optional?: Record<string, never>): AdminSurfaceState;
  /** Read-only view (`get` alone) for the plugin's tools and form delivery. */
  readerFor(required: AgentPluginStateScope, optional?: Record<string, never>): AgentPluginStateReader;
  /** Non-secret summary of the plugin's saved settings: each key with its vault revision, sorted by
   *  key, never a value. The Agent Plugin update journal records it as its settings snapshot, and that
   *  journal is a plaintext file on disk, so values must never reach it. */
  describe(required: AgentPluginStateScope, optional?: Record<string, never>): Promise<AgentPluginStateSummary>;
}

export interface AgentPluginStateSummary {
  readonly keys: readonly { readonly key: string; readonly revision: number }[];
}

/** Mirrors the API-connection lifecycle (`ApiConnectionStatus`); only `connected` serves access tokens. */
export type AdminSurfaceConnectionState = 'connected' | 'reconnect-required' | 'revocation-pending' | 'disconnected';

/**
 * The account actions a surface may start: the keys of `ADMIN_SURFACE_ACTION_INTENTS` in
 * `@jini-ai/agent-plugins/admin-surfaces`, which maps each one to its API-connection start intent.
 */
export type AdminSurfaceConnectionAction = 'connect' | 'reconnect' | 'switch' | 'add-scopes';

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
