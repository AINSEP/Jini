/**
 * What a frontend host hook may read: the request's method and headers (a web `Request` is one),
 * and the per-request values the host's own adapter put in `locals`. Never the socket peer:
 * which address counts as "the client", and whether the request was HTTPS, is host policy
 * (proxy trust), so the host computes it and passes it in `locals`.
 */
export interface FrontendHookInput {
  readonly request: Pick<Request, 'method' | 'headers'>;
  readonly locals: Readonly<Record<string, unknown>>;
}
