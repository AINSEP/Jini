/**
 * @file Host capabilities a plugin tool receives at invocation, typed as ports: the host supplies
 * every implementation (token store, guarded HTTP, limiter, artifact store) and Jini never names a
 * provider. A per-call session wraps them so that (1) every capability stops working the moment the
 * plugin's tools are revoked, even for a module that kept a reference, and (2) an access token the
 * call obtained can never leave through the tool's result or error text. Those two gates are
 * `openCapabilityGate`, shared with the admin-surface session so both enforce them identically.
 *
 * Plugin state reaches a tool read-only: the plugin's admin surface writes its settings (for example
 * which of its products are on), and its tools must honor them, but an agent tool never changes them.
 */

/** Options for guarded HTTP; mirrors `@jini-ai/platform`'s guarded fetch, buffered bodies only. */
export interface AgentPluginHttpOptions {
  readonly method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

/** Mirrors `@jini-ai/http-kit`'s `RateLimitResult`, so a host can pass its limiter straight through. */
export type AgentPluginLimitResult = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

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

export interface AgentPluginToolCapabilities {
  /** Resolves a fresh access token for a connection the host has scoped to this plugin and workspace.
   *  Never a refresh token. The host refuses a connectionRef the calling plugin does not own. */
  readonly connections: { getAccessToken(required: { readonly connectionRef: string }, optional?: Record<string, never>): Promise<string> };
  /** Outbound HTTP through the host's guarded client (allow-list, redirect refusal, deadlines). */
  readonly http: { fetch(required: { readonly url: string }, optional?: AgentPluginHttpOptions): Promise<Response> };
  /** Plugin-declared budgets; the host keys and sizes them. */
  readonly limiter: { check(required: { readonly key: string }, optional?: Record<string, never>): Promise<AgentPluginLimitResult> };
  /** Stores a file the run can hand to the user; returns an opaque reference, never a path. */
  readonly artifacts: { write(required: { readonly name: string; readonly mediaType: string; readonly content: string | Uint8Array }, optional?: Record<string, never>): Promise<{ readonly artifactRef: string }> };
  /** The SAME store the plugin's admin-surface state writes, keyed by the same plugin and workspace
   *  scope. Read-only here: the session exposes `get` alone whatever object the host passes. */
  readonly state: AgentPluginStateReader;
}

/** Context the host uses to scope capabilities: which plugin, which workspace/principal, which call. */
export interface AgentPluginToolCapabilityScope {
  readonly pluginId: string;
  readonly workspaceId: string;
  readonly principalId?: string;
  readonly signal?: AbortSignal;
}

/** Host port: builds the capabilities for one call. Called once per invocation. */
export type AgentPluginToolCapabilitiesPort = (required: AgentPluginToolCapabilityScope, optional?: Record<string, never>) => AgentPluginToolCapabilities;

/** One limit for every reader and writer of plugin state; the admin-surface limits reuse it. */
export const PLUGIN_STATE_MAX_KEY_LENGTH = 128;
const STATE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const REVOKED_MESSAGE = 'This plugin tool was disabled; its capabilities are revoked. Re-enable the plugin and retry.';
export const WITHHELD_OUTPUT_MESSAGE = 'The plugin tool result was withheld because it contained a connection credential.';
export const WITHHELD_ERROR_MESSAGE = 'The plugin tool failed and its error was withheld because it contained a connection credential.';

/**
 * Access tokens one plugin generation obtained, across all of its calls: plugin code that keeps a
 * token in module scope must not be able to return or store it in a later call unseen. Created once
 * per generation (projection `generation`, surface `admit`) and passed to every session it opens.
 */
export type IssuedTokenMemory = Set<string>;
/** Newest tokens kept; access tokens are short-lived, so older ones matter less than bounded memory. */
export const ISSUED_TOKEN_MEMORY_LIMIT = 64;

/** Records `token` as newest, dropping the oldest beyond the limit. @complexity O(1) amortized. */
function remember(issued: IssuedTokenMemory, token: string): void {
  issued.delete(token);
  issued.add(token);
  if (issued.size > ISSUED_TOKEN_MEMORY_LIMIT) issued.delete(issued.values().next().value!);
}

/** True when `value` (serialized) mentions any issued token. Unserializable values fail closed.
 * @complexity O(n * t) for serialized size n and t issued tokens (t ≤ ISSUED_TOKEN_MEMORY_LIMIT). */
function mentionsToken(value: unknown, issued: ReadonlySet<string>): boolean {
  if (issued.size === 0) return false;
  let text: string | undefined;
  try { text = JSON.stringify(value); } catch { return true; }
  if (text === undefined) return false;
  for (const token of issued) if (text.includes(token) || text.includes(JSON.stringify(token).slice(1, -1))) return true;
  return false;
}

/** A serializable view of an error: own fields (code, retryable…), message, stack and `cause`,
 * which is non-enumerable and invisible to JSON. Causes nest `depth` levels deep.
 * @complexity O(depth) levels plus own-field copies. */
function errorProbe(error: unknown, depth: number): unknown {
  if (!(error instanceof Error)) return error;
  return { ...error, message: error.message, stack: error.stack, cause: depth > 0 ? errorProbe(error.cause, depth - 1) : String(error.cause) };
}

/**
 * The revocation and credential gates every capability session shares: this file's tool session and
 * the admin-surface session (`../../admin-surfaces/surface-capabilities.ts`), so both revoke and scan
 * the same way.
 * @param required.isLive - False once the contributing plugin's contributions are revoked.
 * @param required.issued - The plugin generation's token memory (see `IssuedTokenMemory`).
 * @returns `guard` (wraps a capability so it refuses once revoked), `noteToken` (records a token the
 * call obtained), `mentionsToken`, and the `release` (result) and `sanitize` (error) gates.
 * @complexity O(1) to open; the scans are O(serialized size * remembered tokens).
 */
export function openCapabilityGate(required: { readonly isLive: () => boolean; readonly issued: IssuedTokenMemory }, _optional: Record<string, never> = {}) {
  const { isLive, issued } = required;
  return {
    guard: <A extends unknown[], R>(call: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
      if (!isLive()) throw new Error(REVOKED_MESSAGE);
      return call(...args);
    },
    noteToken({ token }: { readonly token: string }): string {
      if (token) remember(issued, token);
      return token;
    },
    mentionsToken: ({ value }: { readonly value: unknown }): boolean => mentionsToken(value, issued),
    /** The result, unless it mentions a token this plugin generation obtained. */
    release<T>({ value }: { readonly value: T }): T {
      if (mentionsToken(value, issued)) throw new Error(WITHHELD_OUTPUT_MESSAGE);
      return value;
    },
    /** The error itself, or a credential-free replacement without `cause` (the cause may hold it). */
    sanitize({ error }: { readonly error: unknown }): unknown {
      return mentionsToken(errorProbe(error, 2), issued) ? new Error(WITHHELD_ERROR_MESSAGE) : error;
    },
  };
}

export type AgentPluginCapabilityGate = ReturnType<typeof openCapabilityGate>;

/** The host capabilities every session wraps the same way: guarded HTTP, limiter and artifacts. @complexity O(1). */
export function guardSharedCapabilities(
  required: { readonly gate: AgentPluginCapabilityGate; readonly host: Pick<AgentPluginToolCapabilities, 'http' | 'limiter' | 'artifacts'> },
  _optional: Record<string, never> = {},
): Pick<AgentPluginToolCapabilities, 'http' | 'limiter' | 'artifacts'> {
  const { gate: { guard }, host } = required;
  return {
    http: Object.freeze({ fetch: guard((input: { readonly url: string }, options?: AgentPluginHttpOptions) => host.http.fetch(input, options)) }),
    limiter: Object.freeze({ check: guard((input: { readonly key: string }) => host.limiter.check(input)) }),
    artifacts: Object.freeze({ write: guard((input: Parameters<AgentPluginToolCapabilities['artifacts']['write']>[0]) => host.artifacts.write(input)) }),
  };
}

/** The key shape every plugin state call shares, so a key never reaches the host as a path or a scope. */
export function checkedStateKey(required: { readonly key: unknown }, _optional: Record<string, never> = {}): string {
  const { key } = required;
  if (typeof key !== 'string' || !STATE_KEY_PATTERN.test(key)) throw new Error(`A settings key must be a short name of at most ${PLUGIN_STATE_MAX_KEY_LENGTH} characters.`);
  return key;
}

/**
 * The read-only state view a session hands out: `get` alone, the key checked and passed on by itself
 * (so plugin code cannot add a scope the host might honor), revoked with the session's gate.
 * @complexity O(1) plus the key check.
 */
export function guardStateReader(required: { readonly gate: AgentPluginCapabilityGate; readonly state: AgentPluginStateReader }, _optional: Record<string, never> = {}): AgentPluginStateReader {
  const { gate, state } = required;
  return Object.freeze({ get: gate.guard(({ key }: { readonly key: string }) => state.get({ key: checkedStateKey({ key }) })) });
}

/**
 * Opens the capability session for one tool call.
 * @param required.capabilities - The host's capabilities for this call.
 * @param required.isLive - False once the contributing plugin's tools are revoked.
 * @param required.issued - The plugin generation's token memory, shared by all its calls.
 * @returns Wrapped capabilities plus `release` (result gate) and `sanitize` (error gate).
 * @complexity O(1) to open; gates are O(serialized size).
 */
export function openCapabilitySession(
  required: { readonly capabilities: AgentPluginToolCapabilities; readonly isLive: () => boolean; readonly issued: IssuedTokenMemory },
  _optional: Record<string, never> = {},
) {
  const { capabilities: host, isLive, issued } = required;
  const gate = openCapabilityGate({ isLive, issued });
  const capabilities: AgentPluginToolCapabilities = Object.freeze({
    connections: Object.freeze({ getAccessToken: gate.guard(async (input: { readonly connectionRef: string }) =>
      gate.noteToken({ token: await host.connections.getAccessToken({ connectionRef: input.connectionRef }) })) }),
    ...guardSharedCapabilities({ gate, host }),
    state: guardStateReader({ gate, state: host.state }),
  });
  return { capabilities, release: gate.release, sanitize: gate.sanitize };
}
