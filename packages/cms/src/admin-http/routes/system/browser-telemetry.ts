import { redactSecrets } from "@jini-ai/core";
import { defineJsonRoute, ok, routeReply, type RouteReply } from "@jini-ai/core/contracts/server";
import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";

/**
 * @file `POST /api/admin/v1/telemetry` — the admin browser's errors and page views, relayed to the
 * same neutral ports server code uses. The optional browser analytics contribution independently
 * follows metrics consent. Errors go to `observability.reportError` (whichever observability provider plugins are
 * installed + enabled + configured, else the no-op); page views go to `tracker.capture`
 * as `admin_pageview`, which `withProductAnalyticsGuards` drops unless the operator's telemetry
 * consent is on. Site attribution is added by the provider host, not here.
 *
 * Privacy: the body is a closed shape (unknown keys are refused, every string is capped), the
 * route is reduced to a template (query/fragment cut, id-like segments become `:id`), and message,
 * stack and component stack lose URL queries and pass core's secret/PII redaction before leaving.
 * Browser sessions only: a machine credential has no browser to report from.
 *
 * Gate order (the hand-written route's, kept byte-identical): credential kind 403 → declared
 * `content-length` 413 → per-principal 429 (`Retry-After`) → body validation 400/413 → 204. Every
 * gate runs in `handle`, after the host's authentication, so validation never runs (and the limiter
 * is never skipped) ahead of the budget check. The host mounts it with `readHeaders: ["content-length"]`.
 */

/** The ports one sanitized event is handed to. */
export interface AdminBrowserTelemetryDeps { tracker: Pick<Tracker, "capture" | "error"> }

/** The host's per-principal budget for this route (its own rate-limit profile). */
export interface BrowserTelemetryLimiter {
  check(required: { key: string }): Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
}

/** What the telemetry route reads: the ports, the budget and the request's credential kind. */
export interface BrowserTelemetryRouteDeps extends AdminBrowserTelemetryDeps {
  limiter: BrowserTelemetryLimiter;
  /** The authenticated request's credential kind (`"session"` for a signed-in browser). Throws
   * (the redacted 500) for a request the session layer never classified. */
  credentialKind: (required: { context: BrowserTelemetryPrincipal | undefined }) => string;
}

/** The fields of the authenticated principal this route reads. */
export interface BrowserTelemetryPrincipal { id: string }

/** The raw body (validated in `handle`, after the budget) and the declared body size. */
export interface BrowserTelemetryInput { body: unknown; contentLength: number }

export type BrowserTelemetryEvent =
  | { type: "error"; message: string; stack: string; componentStack?: string; route: string }
  | { type: "pageview"; route: string };

type Parsed = { ok: true; event: BrowserTelemetryEvent } | { ok: false; status: 400 | 413; error: string };

/** The whole request; the session body parser allows far more, so this route sets its own ceiling. */
export const MAX_TELEMETRY_BODY_BYTES = 16 * 1024;
const CAPS = { message: 1_000, stack: 8_000, componentStack: 4_000, route: 200 } as const;
const KEYS = { error: ["type", "message", "stack", "componentStack", "route"], pageview: ["type", "route"] } as const;
const REQUIRED = { error: ["message", "stack", "route"], pageview: ["route"] } as const;

const ROUTE_SHAPE = /^\/admin(?:\/[A-Za-z0-9:_.~-]*)*$/;
// Segments that name a record rather than a screen: numbers, UUIDs, hex ids, long mixed tokens.
const STRUCTURED_ID_SEGMENT = /^(?:\d+|[a-f\d]{8}-[a-f\d-]{27}|[a-f\d]{12,})$/i;
const MIXED_ID_SEGMENT = /^(?=[^/]*\d)[a-z\d_.~-]{16,}$/i;
// A URL's query or fragment inside free text (a stack frame, a fetch error); the URL itself and a
// stack frame's trailing `:line:col` stay. Both runs are bounded, so a long run costs linear time.
const URL_QUERY = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#()'"]{0,2048})[?#][^\s()'"]{0,8192}?((?::\d+){0,2})(?=[\s()'"]|$)/gi;

/**
 * Reduces a browser route to its template: query and fragment cut, id-like segments `:id`.
 * @returns The template, or `null` when it is not an admin path.
 * @complexity O(n) in the route length (capped by the caller).
 */
export function toRouteTemplate({ raw }: { raw: string }, _optional = {}): string | null {
  const path = raw.split(/[?#]/, 1)[0] ?? "";
  if (!ROUTE_SHAPE.test(path)) return null;
  return path.split("/").map((segment) => ((STRUCTURED_ID_SEGMENT.test(segment) || MIXED_ID_SEGMENT.test(segment)) ? ":id" : segment)).join("/");
}

/** Cuts URL queries/fragments, then core redaction (keys, tokens, e-mails, phones). @complexity O(n). */
export function scrubTelemetryText({ text }: { text: string }, _optional = {}): string {
  return redactSecrets({ input: text.replace(URL_QUERY, "$1$2") });
}

function checkFields({ body, type }: { body: Record<string, unknown>; type: "error" | "pageview" }, _optional = {}): Parsed | null {
  const allowed: readonly string[] = KEYS[type];
  const unknown = Object.keys(body).find((key) => !allowed.includes(key));
  if (unknown) return { ok: false, status: 400, error: `unknown field '${unknown}'` };
  const missing = REQUIRED[type].find((key) => body[key] === undefined);
  if (missing) return { ok: false, status: 400, error: `missing field '${missing}'` };
  for (const key of allowed.slice(1)) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== "string") return { ok: false, status: 400, error: `'${key}' must be a string` };
    if (value.length > CAPS[key as keyof typeof CAPS]) return { ok: false, status: 413, error: `'${key}' is too long` };
  }
  return null;
}

/**
 * Validates and sanitizes one request body into the event that may be forwarded.
 * @complexity O(n) in the (capped) body size.
 */
export function parseBrowserTelemetry({ body }: { body: unknown }, _optional = {}): Parsed {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, status: 400, error: "body must be an object" };
  const record = body as Record<string, unknown>;
  if (record.type !== "error" && record.type !== "pageview") return { ok: false, status: 400, error: "type must be 'error' or 'pageview'" };
  const invalid = checkFields({ body: record, type: record.type });
  if (invalid) return invalid;
  const route = toRouteTemplate({ raw: record.route as string });
  if (route === null) return { ok: false, status: 400, error: "route must be an admin path" };
  return { ok: true, event: record.type === "pageview" ? { type: "pageview", route } : toErrorEvent({ record, route }) };
}

/** The error event with every free-text field scrubbed; fields were already checked to be strings. */
function toErrorEvent({ record, route }: { record: Record<string, unknown>; route: string }, _optional = {}): BrowserTelemetryEvent {
  const componentStack = record.componentStack ? scrubTelemetryText({ text: record.componentStack as string }) : "";
  return { type: "error", route, message: scrubTelemetryText({ text: record.message as string }), stack: scrubTelemetryText({ text: record.stack as string }), ...(componentStack ? { componentStack } : {}) };
}

/** An `Error` carrying the browser's (already scrubbed) message and stack, not this route's. */
function toReportedError(event: Extract<BrowserTelemetryEvent, { type: "error" }>): Error {
  const error = new Error(event.message);
  error.name = "AdminBrowserError";
  error.stack = event.stack || `${error.name}: ${event.message}`;
  return error;
}

/** Hands one sanitized event to its port. Ports never throw by contract; this never awaits them. */
export function forwardBrowserTelemetry({ deps, event, principalId }: { deps: AdminBrowserTelemetryDeps; event: BrowserTelemetryEvent; principalId: string }, _optional: Record<string, never> = {}): void {
  if (event.type === "pageview") {
    void deps.tracker.capture({ name: "admin_pageview", userId: principalId }, { properties: { route: event.route } });
    return;
  }
  const attributes = { source: "admin-browser", route: event.route, ...(event.componentStack ? { componentStack: event.componentStack } : {}) };
  deps.tracker.error({ error: toReportedError(event) }, { context: { operation: "admin.browser.error", attributes } });
}

const reply = (status: number, body: unknown, headers?: Record<string, string>) => ok({ value: routeReply({ status, body, ...(headers ? { headers } : {}) }) });

/**
 * `POST /api/admin/v1/telemetry` (behind the host's admin session, like all of `/api/admin`).
 * The 204 is the spec's `successStatus` with no value, so the answer carries no body.
 * @complexity O(n) in the capped body; one limiter check.
 */
export const browserTelemetryRoute = defineJsonRoute<BrowserTelemetryInput, undefined | RouteReply, BrowserTelemetryRouteDeps, BrowserTelemetryPrincipal>({
  method: "post",
  path: "/api/admin/v1/telemetry",
  parse: (raw) => ok({ value: { body: raw.body, contentLength: Number(raw.headers?.["content-length"] ?? 0) } }),
  handle: async ({ input, deps, context }) => {
    if (deps.credentialKind({ context }) !== "session") return reply(403, { error: "browser telemetry requires a signed-in session", code: "FORBIDDEN" });
    // Early rejection only: the authenticated dispatcher enforces decoded streamed bytes first.
    if (input.contentLength > MAX_TELEMETRY_BODY_BYTES) return reply(413, { error: "telemetry body is too large", code: "PAYLOAD_TOO_LARGE" });
    if (!context) throw new Error("browser telemetry has no authenticated principal");
    const result = await deps.limiter.check({ key: context.id });
    if (!result.allowed) return reply(429, { error: "too many telemetry events", code: "RATE_LIMIT_EXCEEDED" }, { "Retry-After": String(result.retryAfterSeconds) });
    const parsed = parseBrowserTelemetry({ body: input.body });
    if (!parsed.ok) return reply(parsed.status, { error: parsed.error, code: parsed.status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT" });
    forwardBrowserTelemetry({ deps, event: parsed.event, principalId: context.id });
    return ok({ value: undefined });
  },
}, { successStatus: 204 });
