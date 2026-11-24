import { routeReply, type RateLimiter, type RouteInputContext, type RouteReply } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/**
 * @file Shared shapes of the PUBLIC member routes (`/api/members/v1/workspaces/:workspaceId/*`):
 * the raw (web `Response`) spec shape they are mounted in, and the host's credential-refusal mapping.
 *
 * Every policy these routes carry is the host's and is injected: cookie names and attributes, the
 * credential error classes and their copy, the same-origin and body-size gates (which the host runs at
 * the mount, ahead of the spec), and the unexpected-failure 500.
 */

/** A public member route answered as a web `Response` (it sets or clears a cookie), in the exact shape
 *  `@jini-ai/http-kit`'s `RawRouteSpec` mounts. Kept structural so this domain package never imports the
 *  server toolkit: the host mounts it with its raw public mount, which supplies the ports. */
export interface PublicMemberRawRoute<Deps> {
  readonly method: "get" | "post";
  readonly path: string;
  /** Lower-cased request header names the handler reads from `raw.headers`. */
  readonly readHeaders?: readonly string[];
  /** Set when the handler reads `raw.facts` (client address, user agent). */
  readonly requestFacts?: true;
  handle(required: { readonly raw: RouteInputContext; readonly deps: Deps }, optional: { readonly signal: AbortSignal }): Promise<Response>;
}

/** The host's answer for one of its own credential failures (status + flat body), or `undefined` for
 *  anything unexpected, which the host's 500 then answers. */
export type MemberAuthRefusalFor = (required: { readonly error: unknown }) => { readonly status: number; readonly body: unknown } | undefined;

/** Throw the host's refusal for a known credential failure; rethrow anything else unchanged.
 * @returns Never.
 * @complexity O(1) plus the host mapping.
 */
export function refuseMemberAuthError(
  { error, refusalFor }: { readonly error: unknown; readonly refusalFor: MemberAuthRefusalFor },
  _optional: Record<string, never> = {},
): never {
  const refusal = refusalFor({ error });
  if (refusal) throw new RouteRefusalError({ status: refusal.status, body: refusal.body });
  throw error;
}

/** A shared, app-boot-scoped member limiter (the host's; never a per-request one). */
export type MemberRequestLimiter = Pick<RateLimiter, "check">;

/** Validate a member route's string-only DTO before missing identifiers can reach repository queries:
 *  every required field a string, every other field an allowed optional string.
 * @returns The body record, or `null` when its shape is wrong.
 * @complexity O(k) fields.
 */
export function memberStringBody<Field extends string, OptionalField extends string = never>(
  { body, fields, optionalFields = [] }: { body: unknown; fields: readonly Field[]; optionalFields?: readonly OptionalField[] },
  _optional: Record<string, never> = {},
): (Record<Field, string> & Partial<Record<OptionalField, string>>) | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (!fields.every(field => typeof record[field] === "string")) return null;
  const allowed: readonly string[] = [...fields, ...optionalFields];
  if (!Object.keys(record).every(field => allowed.includes(field) && typeof record[field] === "string")) return null;
  return record as Record<Field, string> & Partial<Record<OptionalField, string>>;
}

/** The client address the host resolved for this request (its trust-proxy answer).
 * @throws When the host mounted the route without its request facts — a wiring bug, refused rather than
 *  keyed on an empty string.
 */
export function memberClientAddress({ raw }: { raw: RouteInputContext }, _optional: Record<string, never> = {}): string {
  if (!raw.facts) throw new Error("public member route: the host mounted this route without its request facts");
  return raw.facts.clientAddress;
}

/** The 429 every member limit answers, with the wait in `Retry-After` and in its JSON detail. */
function tooManyMemberRequests({ retryAfterSeconds }: { retryAfterSeconds: number }, _optional: Record<string, never> = {}): RouteReply {
  return routeReply({
    status: 429,
    body: { error: "too many member authentication requests", code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds } },
    headers: { "Retry-After": String(retryAfterSeconds) },
  });
}

/** W-002/W-003 changed by owner 2026-10-26: check the IP limit first. An already rate-limited
 * IP gets 429 without charging email or identity counters, so it cannot exhaust a victim's budget.
 * After IP admission, all applicable counters must pass before any service call. Retry-After and
 * its JSON detail report the longest applicable wait among checked, denied counters.
 * Shared by password/link/reset requests, against shared, app-boot-scoped limiter instances
 * (C-015), never per-request ones. The email key is trimmed and lowercased like the service.
 * @returns The 429 reply, or `undefined` when every counter admits the request.
 * @complexity O(1) plus the injected limiters.
 */
export async function memberRequestLimitReply(
  { clientAddress, ipLimiter, email, emailLimiter, identity }: {
    clientAddress: string; ipLimiter: MemberRequestLimiter; email?: string; emailLimiter?: MemberRequestLimiter;
    identity?: { key: string; limiter: MemberRequestLimiter };
  },
  _optional: Record<string, never> = {},
): Promise<RouteReply | undefined> {
  const ip = await ipLimiter.check({ key: clientAddress });
  if (!ip.allowed) return tooManyMemberRequests({ retryAfterSeconds: ip.retryAfterSeconds });
  const checks = await Promise.all([
    ...(emailLimiter ? [emailLimiter.check({ key: (email ?? "").trim().toLowerCase() || "<empty>" })] : []),
    ...(identity ? [identity.limiter.check({ key: identity.key })] : []),
  ]);
  const waits = checks.flatMap(result => result.allowed ? [] : [result.retryAfterSeconds]);
  return waits.length === 0 ? undefined : tooManyMemberRequests({ retryAfterSeconds: Math.max(...waits) });
}
