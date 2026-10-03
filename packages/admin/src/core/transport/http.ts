/**
 * @file The default HTTP `AdminTransport`, and the client assembler.
 *
 * Ported from the reference implementation's `lib/api.ts` `request()`, with the two
 * hard-coded values it closed over — the base URL and the same-origin cookie policy — lifted into
 * options. Request deadlines, typed failures and successful response metadata preserve the
 * original contracts with neutral operator copy. Error-body parsing deliberately keeps the
 * `.catch(() => ({}))` outcome on a body that is not JSON, while distinguishing it from parsed null.
 */

import { AdminApiError } from './errors.js';
import type { AdminClient, AdminRouteGroupFactory, AdminTransport } from './types.js';

/**
 * The subset of `fetch` this transport actually uses.
 *
 * The required object holds a string URL; the optional object is standard RequestInit.
 * Adapt native fetch at the host boundary with `({ url }, init) => fetch(url, init)`.
 * Keeping that adapter outside the core makes the transport reusable without ambient fetch.
 */
// The URL field is deliberately a string: transport calls never pass URL or Request
// objects, so a test double need not implement native fetch's unused input shapes.
export type AdminFetch = (requiredArgs: { readonly url: string }, optionalArgs?: RequestInit) => Promise<Response>;

interface HttpTransportRequiredArgs {
  /**
   * Prefix for every path (`/api/admin/v1`). No trailing slash — paths always start with `/`.
   *
   * Unlike the reference implementation's module-level `const BASE`, this is per-transport so one
   * process can talk to more than one admin API. A fleet orchestrator managing many site instances
   * in one process is exactly the case where a single shared base is the thing that would have to
   * be unpicked first.
   */
  readonly baseUrl: string;

  /**
   * Required object-argument `fetch` port. Wrap native fetch at the host boundary. Present so a test can supply a stub without
   * `vi.stubGlobal`, which is what forced the reference implementation's own hook tests to assert
   * URLs and HTTP methods when what they meant to describe was behaviour.
   */
  readonly fetch: AdminFetch;
}

export interface HttpTransportOptions {
  /**
   * Merged into every request. `Content-Type: application/json` is applied unless overridden;
   * a per-call `headers` still wins over both.
   */
  readonly headers?: Readonly<Record<string, string>>;

  /**
   * Defaults to `same-origin`, matching the cookie-session admin the reference implementation
   * ships. A token-authenticated
   * host sets `omit` and supplies an `Authorization` header instead.
   */
  readonly credentials?: RequestCredentials;

  /** Defaults to 60 seconds; a caller-supplied request signal takes precedence. */
  readonly timeoutMs?: number;

  /** Host lifecycle port: navigation-induced network rejection is cancellation, not downtime. */
  readonly isPageUnloading?: () => boolean;
}

// Browser connection pools can leave requests queued forever without a fetch rejection.
// 60 seconds bounds that hang while allowing large uploads on slow connections to complete.
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/** Unparseable proxy/crash responses must remain distinct from valid JSON null or {}. */
const UNPARSEABLE_BODY = Symbol('unparseable-json-body');

function unreachableApiMessage({ status }: { readonly status?: number } = {}): string {
  const detail = status === undefined ? '' : ` (HTTP ${status})`;
  return `cannot reach the API${detail} — is the server running?`;
}

/** Timeout DOMExceptions can come from another realm; instanceof Error alone is unreliable. */
function throwTranslatedFetchFailure(
  { cause, timeoutMs }: { readonly cause: unknown; readonly timeoutMs: number },
  { isPageUnloading }: Pick<HttpTransportOptions, 'isPageUnloading'> = {},
): never {
  const name = cause && typeof cause === 'object' && 'name' in cause ? cause.name : undefined;
  if (name === 'AbortError') throw cause;
  if (name === 'TimeoutError') {
    const message = `the API did not respond within ${timeoutMs / 1000}s — the browser may be out of free connections for this origin (try closing other admin tabs) or the server is unresponsive`;
    throw new AdminApiError({ message, status: 0 }, {
      code: 'REQUEST_TIMEOUT', body: { cause: cause instanceof Error ? cause.message : String(cause) },
    });
  }
  // Only fetch's TypeError proves a network failure. Adapter bugs retain their original type.
  if (!(cause instanceof TypeError)) throw cause;
  if (isPageUnloading?.()) throw new DOMException('request cancelled: the page is unloading', 'AbortError');
  throw new AdminApiError({ message: unreachableApiMessage(), status: 0 }, {
    code: 'API_UNREACHABLE', body: { cause: cause.message },
  });
}

/**
 * The standard `fetch`-backed transport.
 *
 * Success bodies are parsed as JSON. A non-2xx response throws `AdminApiError` carrying the
 * server's `error` string, HTTP status, canonical `code` when present, and the raw parsed body.
 */
export function createHttpTransport(
  { baseUrl, fetch: doFetch }: HttpTransportRequiredArgs,
  { headers: baseHeaders, credentials = 'same-origin', timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, isPageUnloading }: HttpTransportOptions = {},
): AdminTransport {
  return {
    async request<T>({ path }: { readonly path: string }, options: Parameters<AdminTransport['request']>[1] = {}): Promise<T> {
      const { onOk, ...init } = options;
      // Headers normalizes names and accepts every HeadersInit form; object spreads lose
      // Headers instances and treat tuple arrays as numeric keys instead of header entries.
      const headers = new Headers({ 'Content-Type': 'application/json' });
      new Headers(baseHeaders).forEach((value, name) => headers.set(name, value));
      new Headers(init.headers).forEach((value, name) => headers.set(name, value));
      // An explicit signal owns cancellation and its deadline; never replace it with ours.
      const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
      const res = await doFetch({ url: `${baseUrl}${path}` }, {
        credentials,
        ...init,
        signal,
        // Assign last so a per-call header overrides both the JSON default and the transport's
        // own. The reference implementation's original spread `...init` last, which meant a call passing `headers` lost
        // the `Content-Type` default rather than merging with it.
        headers,
      }).catch((cause: unknown) => throwTranslatedFetchFailure({ cause, timeoutMs },
        isPageUnloading ? { isPageUnloading } : {}));

      // A 204 or an empty body is not a JSON parse failure worth surfacing — it is a successful
      // mutation with nothing to return. Same `.catch(() => ({}))` as the original.
      const parsed = await res.json().catch(() => UNPARSEABLE_BODY);
      const wasUnparseable = parsed === UNPARSEABLE_BODY;
      const body = (wasUnparseable ? {} : parsed) as Record<string, unknown>;

      if (!res.ok) {
        // Valid JSON proves the application answered. Only unparseable 5xx responses indicate
        // an unreachable upstream or a server crash outside the application's JSON envelope.
        const noAppEnvelope = wasUnparseable && res.status >= 500;
        throw new AdminApiError(
          { message: String(body?.error ?? (noAppEnvelope ? unreachableApiMessage({ status: res.status }) : `request failed (${res.status})`)), status: res.status },
          { code: noAppEnvelope ? 'API_UNREACHABLE' : typeof body?.code === 'string' ? body.code : undefined, body },
        );
      }
      onOk?.({ response: res });
      return body as T;
    },
  };
}

/**
 * Assembles route groups into one client.
 *
 * Shared and host-owned groups are indistinguishable here on purpose — both are just
 * `({ transport }) => port`. See `types.ts`'s header for the worked example.
 */
export function createAdminClient<TGroups extends Record<string, AdminRouteGroupFactory<unknown>>>(
  { transport, groups }: { readonly transport: AdminTransport; readonly groups: TGroups },
): AdminClient<TGroups> {
  const built: Record<string, unknown> = { transport };
  for (const [name, factory] of Object.entries(groups)) {
    // `transport` is a reserved key: shadowing it would silently replace the escape hatch every
    // host relies on for un-wrapped routes. Loud failure beats a client whose `.transport` is a
    // route group.
    if (name === 'transport') {
      throw new Error('createAdminClient: "transport" is a reserved route-group name');
    }
    built[name] = factory({ transport });
  }
  return built as AdminClient<TGroups>;
}
