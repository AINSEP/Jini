import type { DeclaredApiConnection, PluginHttp as HttpPort } from "./host-ports.js";

/**
 * @file The HTTP a connection's hooks module (account identity, revocation, scope sets) receives:
 * the host's guarded plugin HTTP, limited to the origins that connection declares (`apiOrigins`)
 * plus its token endpoint's origin (where providers serve revocation). Hooks see fresh access and
 * refresh tokens during sign-in and disconnect, so unscoped public https would let a hook carry
 * one to any host; this keeps them on the provider the plugin declared.
 */

/** The plugin HTTP capability (the same shape plugin tools get). */
export type PluginHttp = HttpPort;

export const CONNECTION_HOOK_UNDECLARED_ORIGIN_MESSAGE = "A plugin's sign-in code may only call its connection's declared API addresses and its token endpoint. Report this to the plugin author.";

/**
 * Wraps `http` so only the connection's declared origins are reachable. The origin is compared
 * exactly (scheme, host and port), so a look-alike host, plaintext or another port is refused
 * before anything is sent; an unparsable URL gets the same refusal.
 * @complexity O(o) declared origins per fetch, then the wrapped fetch.
 */
export function createConnectionHookHttp(
  required: { readonly http: PluginHttp; readonly connection: Pick<DeclaredApiConnection, "apiOrigins" | "descriptor"> },
  _optional: Record<string, never> = {},
): PluginHttp {
  const { http, connection } = required;
  const allowed = new Set([...connection.apiOrigins, new URL(connection.descriptor.tokenEndpoint).origin]);
  return {
    async fetch(target, options) {
      const origin = URL.parse(target.url)?.origin;
      if (origin === undefined || !allowed.has(origin)) throw new Error(CONNECTION_HOOK_UNDECLARED_ORIGIN_MESSAGE);
      return http.fetch(target, options);
    },
  };
}
