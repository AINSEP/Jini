/**
 * @file The per-request facts a frontend hook needs that a web `Request` cannot carry: which address
 * counts as the client, which protocol the request was served over, whether it counts as secure, and
 * the host app's parsed query. Express (and its trust-proxy setting) decides these, so the host
 * adapter computes them once per dispatch (`server/inbound/shared/request-facts.ts`) and hands them to
 * Jini's hooks through `locals`. This file has no Express import so domain code can read them.
 */

/** The key the facts sit under in a hook's `locals`. */
export const JINI_REQUEST_FACTS = "jiniRequestFacts";

export interface RequestFacts {
  /** Express's answer to "who is the client" under this app's trust-proxy setting (or `"unknown"`). The quota key. */
  readonly clientAddress: string;
  /** The protocol the visitor-origin check compares with: the first `X-Forwarded-Proto` hop when exactly `http`/`https`, otherwise Express's own. NOT the same fact as `secure`. */
  readonly servingProtocol: string;
  /** Express's `req.secure`: whether the request counts as HTTPS under the trust-proxy setting. Decides the cookie's `Secure`. */
  readonly secure: boolean;
  /** The host app's parsed query (its own `qs` rules: a repeated or bracketed key is an array or an object). */
  readonly query: Readonly<Record<string, unknown>>;
}

function isFacts(value: unknown): value is RequestFacts {
  if (typeof value !== "object" || value === null) return false;
  const facts = value as Partial<Record<keyof RequestFacts, unknown>>;
  const texts = typeof facts.clientAddress === "string" && typeof facts.servingProtocol === "string";
  return texts && typeof facts.secure === "boolean" && typeof facts.query === "object" && facts.query !== null;
}

/**
 * The facts the host adapter put in `locals`.
 * @throws Error when they are absent or malformed: the route was mounted without the adapter. There is deliberately no default
 * address: a default would put every request in one shared quota key, and fail open instead of failing loudly.
 */
export function readRequestFacts({ locals }: { readonly locals: Readonly<Record<string, unknown>> }, _optional: Record<string, never> = {}): RequestFacts {
  const facts = locals[JINI_REQUEST_FACTS];
  if (!isFacts(facts)) throw new Error(`request facts are missing from locals.${JINI_REQUEST_FACTS}: the route was mounted without mountJiniRoutes or requestHookInput`);
  return facts;
}
