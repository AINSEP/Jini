/**
 * @file The admin's page-wide failure reporter: turns a final failed API response (or a caught
 * local failure) into one redacted, copyable `UserFacingError` on the host's failure channel.
 *
 * Instance-owned: `createAdminFailureReporter` binds the host's channel, failure vocabulary,
 * redaction options, version labels and error decoder once; the host module calls it once and its
 * importers use the bound values. Product copy (the vocabulary, the app version label, the server
 * codes for "the assistant is not running yet") stays with the host.
 */
import type { describeRequestFailure, formatUserFacingError, RequestFailureVocabulary, SecretRedactionOptions, UserFacingError } from "@jini-ai/core";
import { getAdminDraftIdentity } from "./admin-draft-identity.js";

/** The slice of a failure channel (`@jini-ai/ui/panel-kit`'s `createFailureChannel`) the reporter publishes to. */
export interface AdminFailureChannelPort {
  publish(input: { failure: UserFacingError; generation?: number }): void;
  getGeneration(): number;
}

/** The decoded-error fields the reporter reads (`@jini-ai/protocol`'s `decodeApiError` result). */
export interface AdminDecodedError {
  readonly details?: unknown;
  readonly requestId?: string;
}

export interface CreateAdminFailureReporterInput<Channel extends AdminFailureChannelPort> {
  /** One retained incident for this admin instance; reset invalidates older in-flight requests. */
  readonly channel: Channel;
  readonly vocabulary: RequestFailureVocabulary;
  readonly redaction: SecretRedactionOptions;
  /** The "Copy details" app label, e.g. `<App> Admin 1.2.3`. */
  readonly appVersion: string;
  readonly jiniVersion: string;
  readonly decodeError: (required: { body: unknown }) => AdminDecodedError;
  /** Server codes a passive read answers while the assistant's background service is not running. */
  readonly notRunningCodes: ReadonlySet<string>;
  /** The host's failure formatter (core's `formatUserFacingError`); it bounds and redacts every shown field. */
  readonly formatUserFacingError: typeof formatUserFacingError;
  /** The host's request-failure describer (core's `describeRequestFailure`) over `vocabulary`. */
  readonly describeRequestFailure: typeof describeRequestFailure;
}

export interface AdminFailureReporter<Channel extends AdminFailureChannelPort> {
  readonly adminFailureChannel: Channel;
  readonly isPageWideFailure: (required: { status: number; method: string; code?: string | undefined }, optional?: Record<string, never>) => boolean;
  readonly publishAdminFailure: (
    required: { body: unknown; path: string; method?: string; status: number; generation: number; entry?: "page" },
    optional?: { basePath?: string },
  ) => void;
  readonly publishLocalAdminFailure: (
    required: { message: string; action: string; step: string; cause: unknown },
    optional?: { generation?: number },
  ) => void;
}

function record({ value }: { value: unknown }, _options = {}): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Pages are saved through the posts routes, whose wording says "post"; a caller that knows the row is a page swaps the word.
 * @complexity O(n) in the already-bounded text. */
function asPage({ text }: { text: string }, _options = {}): string {
  return text.replace(/\bpost(s?)\b/gi, (match, plural: string) => (match[0] === "P" ? "Page" : "page") + plural);
}

const optionalString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** The named fields that hold strings; absent or non-string fields are left out, not set to undefined. */
function stringFields<Key extends string>({ value, keys }: { value: Record<string, unknown>; keys: readonly Key[] }, _options = {}): Partial<Record<Key, string>> {
  return Object.fromEntries(keys.flatMap(key => (typeof value[key] === "string" ? [[key, value[key]]] : []))) as Partial<Record<Key, string>>;
}

/** Accept only a formatter-shaped explanation from an authenticated response. Never stringify bodies.
 * @complexity O(1), fixed field checks; formatter bounds and redacts all displayed text.
 * @overallScore 98 — trusted server disclosure remains a boundary contract, tested with anonymous canaries.
 */
function approvedFailure({ value, entry, redaction, format }: {
  value: unknown; entry?: "page"; redaction: SecretRedactionOptions; format: typeof formatUserFacingError;
}): UserFacingError | undefined {
  const candidate = record({ value });
  if (typeof candidate.message !== "string" || typeof candidate.action !== "string" || typeof candidate.step !== "string" || typeof candidate.cause !== "string") return undefined;
  const word = ({ text }: { text: string }, _options = {}) => (entry === "page" ? asPage({ text }) : text);
  return format({ message: word({ text: candidate.message }), action: word({ text: candidate.action }), step: word({ text: candidate.step }), cause: candidate.cause }, {
    ...redaction, ...stringFields({ value: candidate, keys: ["errorId", "time", "appVersion", "jiniVersion"] }),
  });
}

/** Describe only the incident evidence actually returned by the request, never an inferred report.
 * @complexity O(1), no I/O. @overallScore 100 — fixed copy with directly tested reference/response cases.
 */
function incidentCause({ status, errorId }: { status: number; errorId?: string | undefined }): string {
  if (errorId) return "The error ID identifies the server report.";
  if (status === 0) return "No server response was received, so no server incident ID is available.";
  return "The server did not provide an incident ID for this response.";
}

/** Static route words and version segments stay; anything else (ids, slugs, tokens) becomes ":id".
 * Query strings and fragments never render. @complexity O(n) in the 2048-character bounded path. */
function redactedRoute({ path }: { path: string }, _options = {}): string {
  const clean = path.slice(0, 2048).split(/[?#]/, 1)[0] ?? "";
  return clean.split("/").slice(0, 32).map(segment => (segment === "" || /^(?:[a-z][a-z-]{0,39}|v\d{1,2})$/.test(segment) ? segment : ":id")).join("/");
}

/** The server's own small `{error, code}` refusal, in plain words; anything larger or differently
 * shaped is never stringified. The formatter still redacts and bounds the result.
 * @complexity O(1), fixed field checks. */
function serverReply({ body }: { body: unknown }, _options = {}): string | undefined {
  const reply = record({ value: body });
  const { error, code } = reply;
  if (Object.keys(reply).length > 4 || typeof error !== "string" || typeof code !== "string") return undefined;
  if (error.length > 300 || !/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) return undefined;
  return `The server answered ${code}: ${error}.`;
}

/** Step and cause for one failed response. A route the vocabulary names keeps its approved wording;
 * any other route names its method and redacted path, plus the server's reply after sign-in.
 * A route missing from the vocabulary gets only the fallback wording; detect that by comparing with
 * the wording an empty route gets, so the shared describer stays the one owner of the fallback.
 * @complexity O(path length) plus one fallback describe call. */
function failureEvidence(
  { body, path, method, status, step, errorId, authenticated, vocabulary, describe }: {
    body: unknown; path: string; method?: string | undefined; status: number; step: string; errorId?: string | undefined; authenticated: boolean; vocabulary: RequestFailureVocabulary;
    describe: typeof describeRequestFailure;
  },
  _options = {},
): { step: string; cause: string } {
  const unlisted = describe({ ...(method !== undefined ? { method } : {}), route: "", vocabulary }).step === step;
  const label = unlisted ? `${method?.toUpperCase() ?? "Request"} ${redactedRoute({ path })}` : step;
  const said = unlisted && authenticated ? serverReply({ body }) : undefined;
  return {
    step: status === 0 ? `${label} (no server response)` : `${label} (HTTP ${status})`,
    cause: said ? `${incidentCause({ status, errorId })} ${said}` : incidentCause({ status, errorId }),
  };
}

/** A browser refusing clipboard access (permission, unfocused page) is an expected refusal, not an
 * incident: show inline text only. Any other clipboard-path throw is a defect and is published.
 * @complexity O(1). */
export function isClipboardRefusal({ error }: { error: unknown }, _optional: Record<string, never> = {}): boolean {
  return typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "NotAllowedError";
}

/**
 * Binds the reporter to the host's channel and vocabulary.
 * @param optional.now / optional.mintErrorId - Clock and id source; the browser's by default.
 * @complexity O(1) to build; each publish is O(path length + bounded formatted text).
 */
export function createAdminFailureReporter<Channel extends AdminFailureChannelPort>(
  required: CreateAdminFailureReporterInput<Channel>,
  { now = () => new Date(), mintErrorId = () => crypto.randomUUID() }: { now?: () => Date; mintErrorId?: () => string } = {},
): AdminFailureReporter<Channel> {
  const { channel, vocabulary, redaction, appVersion, jiniVersion, decodeError, notRunningCodes, formatUserFacingError, describeRequestFailure } = required;
  const versions = () => ({ ...redaction, appVersion, jiniVersion, time: now().toISOString() });

  /** Whether a final failed request belongs on the page-wide notice. Client errors stay with their
   * caller. A read answered "the assistant is not running yet" is a calm state its caller already shows
   * (the picker's "Connecting to the assistant…", External MCP's wait) and re-reads, not an incident;
   * the caller still receives the rejection. Writes refused the same way stay loud.
   * @complexity O(1). */
  function isPageWideFailure({ status, method, code }: { status: number; method: string; code?: string | undefined }, _options = {}): boolean {
    if (status !== 0 && status < 500) return false;
    const read = method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD";
    return !(read && status === 503 && code !== undefined && notRunningCodes.has(code));
  }

  /** The incident reference a failure reply carries: the decoded details' error id, else the body's,
   * else the request id. Split out of `publishAdminFailure` (complexity ratchet); same precedence.
   * @complexity O(1). */
  function failureReference(
    { details, body, requestId }: { details: Record<string, unknown>; body: unknown; requestId?: unknown },
    _optional = {},
  ): string | undefined {
    // Each source is checked for a string before falling through: a malformed `details.errorId`
    // (a number, null) must not win the chain and then be dropped, hiding a real lower ID.
    return optionalString(details.errorId) ?? optionalString(record({ value: body }).errorId) ?? optionalString(requestId);
  }

  /** The vocabulary wording for a failed request; a page entry names its route as `/pages/`.
   * Split out of `publishAdminFailure` (complexity ratchet); same mapping.
   * @complexity O(path length). */
  function requestWording(
    { method, path, entry }: { method?: string | undefined; path: string; entry?: "page" | undefined },
    _optional = {},
  ): ReturnType<typeof describeRequestFailure> {
    const route = entry === "page" ? path.replace(/\/posts\//, "/pages/") : path;
    return describeRequestFailure({ ...(method !== undefined ? { method } : {}), route, vocabulary });
  }

  /** The host's disclosure adapter: safe shared wording for legacy failures, approved details after sign-in.
   * Inputs are the final failed response and its captured session generation; no new I/O or retries.
   * @param options.basePath The API prefix the request was sent under, so an unlisted route is named in full.
   * @overallScore 98 — the server owns approved explanation accuracy; legacy text renders only as a small,
   * redacted `{error, code}` reply from a signed-in request to a route the vocabulary does not name.
   */
  function publishAdminFailure(
    { body, path, method, status, generation, entry }: { body: unknown; path: string; method?: string; status: number; generation: number; entry?: "page" },
    { basePath = "" }: { basePath?: string } = {},
  ): void {
    const decoded = decodeError({ body });
    const details = record({ value: decoded.details });
    const errorId = failureReference({ details, body, requestId: decoded.requestId });
    // Approved server explanations only for signed-in, non-auth requests.
    const authenticated = getAdminDraftIdentity() !== null && !path.startsWith("/auth/");
    const approved = authenticated ? approvedFailure({ value: details.failure, redaction, format: formatUserFacingError, ...(entry ? { entry } : {}) }) : undefined;
    const wording = requestWording({ method, path, entry });
    const { step, cause } = failureEvidence({ body, path: `${basePath}${path}`, method, status, step: wording.step, errorId, authenticated, vocabulary, describe: describeRequestFailure });
    const failure = approved ?? formatUserFacingError({ ...wording, step, cause }, { ...versions(), ...(errorId !== undefined ? { errorId } : {}) });
    channel.publish({ failure, generation });
  }

  /** The ONE way an admin action reports a failure that did not come from an API request (those are
   * published by the host's request client already — never publish them again). Shows the shared notice with the
   * plain explanation and a Copy details block: error ID, step, redacted cause, app + Jini version, time.
   * Never call it for an expected refusal (bad input, refused link, clipboard refusal): show inline text.
   * @param optional.generation - Capture `adminFailureChannel.getGeneration()` BEFORE an await so a
   *   session/site switch drops a stale report; defaults to the current generation.
   */
  function publishLocalAdminFailure(
    { message, action, step, cause }: { message: string; action: string; step: string; cause: unknown },
    { generation = channel.getGeneration() }: { generation?: number } = {},
  ): void {
    channel.publish({ failure: formatUserFacingError({ message, action, step, cause }, { ...versions(), errorId: mintErrorId() }), generation });
  }

  return { adminFailureChannel: channel, isPageWideFailure, publishAdminFailure, publishLocalAdminFailure };
}
