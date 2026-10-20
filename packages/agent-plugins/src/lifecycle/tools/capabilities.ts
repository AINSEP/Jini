/**
 * @file Host capabilities a plugin tool receives at invocation, typed as ports: the host supplies
 * every implementation (token store, guarded HTTP, limiter, artifact store) and Jini never names a
 * provider. A per-call session wraps them so that (1) every capability stops working the moment the
 * plugin's tools are revoked, even for a module that kept a reference, and (2) an access token the
 * call obtained can never leave through the tool's result or error text.
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

export const REVOKED_MESSAGE = 'This plugin tool was disabled; its capabilities are revoked. Re-enable the plugin and retry.';
export const WITHHELD_OUTPUT_MESSAGE = 'The plugin tool result was withheld because it contained a connection credential.';
export const WITHHELD_ERROR_MESSAGE = 'The plugin tool failed and its error was withheld because it contained a connection credential.';

/** True when `value` (serialized) mentions any issued token. Unserializable values fail closed.
 * @complexity O(n * t) for serialized size n and t issued tokens (t is tiny per call). */
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
 * Opens the capability session for one tool call.
 * @param required.capabilities - The host's capabilities for this call.
 * @param required.isLive - False once the contributing plugin's tools are revoked.
 * @returns Wrapped capabilities plus `release` (result gate) and `sanitize` (error gate).
 * @complexity O(1) to open; gates are O(serialized size).
 */
export function openCapabilitySession(required: { readonly capabilities: AgentPluginToolCapabilities; readonly isLive: () => boolean }, _optional: Record<string, never> = {}) {
  const { capabilities: host, isLive } = required;
  const issued = new Set<string>();
  const guard = <A extends unknown[], R>(call: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    if (!isLive()) throw new Error(REVOKED_MESSAGE);
    return call(...args);
  };
  const capabilities: AgentPluginToolCapabilities = Object.freeze({
    connections: Object.freeze({ getAccessToken: guard(async (input: { readonly connectionRef: string }) => {
      const token = await host.connections.getAccessToken({ connectionRef: input.connectionRef });
      if (token) issued.add(token);
      return token;
    }) }),
    http: Object.freeze({ fetch: guard((input: { readonly url: string }, options?: AgentPluginHttpOptions) => host.http.fetch(input, options)) }),
    limiter: Object.freeze({ check: guard((input: { readonly key: string }) => host.limiter.check(input)) }),
    artifacts: Object.freeze({ write: guard((input: Parameters<AgentPluginToolCapabilities['artifacts']['write']>[0]) => host.artifacts.write(input)) }),
  });
  return {
    capabilities,
    /** The result, unless it mentions a token this call obtained. */
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
