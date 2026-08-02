/**
 * @file The default HTTP `AdminTransport`, and the client assembler.
 *
 * Ported from the reference implementation's `lib/api.ts` `request()`, with the two
 * hard-coded values it closed over — the base URL and the same-origin cookie policy — lifted into
 * options. Nothing else about the request/response handling changed; the error-body parsing in
 * particular is deliberately identical, including the `.catch(() => ({}))` on a body that is not
 * JSON.
 */

import { AdminApiError } from './errors.js';
import type { AdminClient, AdminRouteGroupFactory, AdminTransport } from './types.js';

/**
 * The subset of `fetch` this transport actually uses.
 *
 * Deliberately narrower than `typeof globalThis.fetch`: the transport only ever passes a string
 * URL, never a `URL` or a `Request`. Declaring that narrows what a test double has to implement
 * (the global signature forces a stub to handle three input shapes it will never receive), and
 * the real `globalThis.fetch` is still assignable here because a function accepting a wider input
 * satisfies one accepting a narrower one.
 */
export type AdminFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpTransportOptions {
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
   * Injected `fetch`, defaulting to the global. Present so a test can supply a stub without
   * `vi.stubGlobal`, which is what forced the reference implementation's own hook tests to assert
   * URLs and HTTP methods when what they meant to describe was behaviour.
   */
  readonly fetch?: AdminFetch;

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
}

/**
 * The standard `fetch`-backed transport.
 *
 * Success bodies are parsed as JSON. A non-2xx response throws `AdminApiError` carrying the
 * server's `error` string, HTTP status, canonical `code` when present, and the raw parsed body.
 */
export function createHttpTransport(options: HttpTransportOptions): AdminTransport {
  const { baseUrl, headers: baseHeaders, credentials = 'same-origin' } = options;
  const doFetch = options.fetch ?? globalThis.fetch;

  return {
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const res = await doFetch(`${baseUrl}${path}`, {
        credentials,
        ...init,
        // Spread last so a per-call header overrides both the JSON default and the transport's
        // own. The reference implementation's original spread `...init` last, which meant a call passing `headers` lost
        // the `Content-Type` default rather than merging with it.
        headers: {
          'Content-Type': 'application/json',
          ...baseHeaders,
          ...(init.headers as Record<string, string> | undefined),
        },
      });

      // A 204 or an empty body is not a JSON parse failure worth surfacing — it is a successful
      // mutation with nothing to return. Same `.catch(() => ({}))` as the original.
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (!res.ok) {
        throw new AdminApiError(
          String(body?.error ?? `request failed (${res.status})`),
          res.status,
          typeof body?.code === 'string' ? body.code : undefined,
          body,
        );
      }
      return body as T;
    },
  };
}

/**
 * Assembles route groups into one client.
 *
 * Jini-shipped and host-owned groups are indistinguishable here on purpose — both are just
 * `(transport) => port`. See `types.ts`'s header for the worked example.
 */
export function createAdminClient<TGroups extends Record<string, AdminRouteGroupFactory<unknown>>>(
  transport: AdminTransport,
  groups: TGroups,
): AdminClient<TGroups> {
  const built: Record<string, unknown> = { transport };
  for (const [name, factory] of Object.entries(groups)) {
    // `transport` is a reserved key: shadowing it would silently replace the escape hatch every
    // host relies on for un-wrapped routes. Loud failure beats a client whose `.transport` is a
    // route group.
    if (name === 'transport') {
      throw new Error('createAdminClient: "transport" is a reserved route-group name');
    }
    built[name] = factory(transport);
  }
  return built as AdminClient<TGroups>;
}
