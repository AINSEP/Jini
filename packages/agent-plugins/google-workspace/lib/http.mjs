/**
 * @file The one Google HTTP client of the Google Workspace plugin: every Sheets and Drive call (chat
 * tools, admin actions, form delivery) goes through `createGoogleClient(...).request(...)`.
 *
 * Exists so the rules that keep a person's data and sign-in safe live in one place:
 * - the access token is fetched from the host immediately before each attempt and is never
 *   returned, logged or put in an error;
 * - quotas are the host's: it charges the budgets the connection declares (per account and per
 *   instance) on every token read, so this client keeps no limiter of its own; a budget refusal
 *   is a `quota-delay` like Google's 429;
 * - a failure becomes a safe {@link GoogleWorkspaceError} (code, `retryable`, `retryAfterMs`,
 *   `outcome`, next action); Google's message text is dropped because it can echo sheet contents;
 * - only retryable failures are retried, with jittered backoff that honours Retry-After, and a
 *   non-idempotent write whose outcome is unknown is never replayed;
 * - a token can expire between the host's freshness check and Google's: a 401 gets one more token
 *   read, and is retried only if that token differs; an unchanged token or second 401 requires reconnect.
 * Redirects, HTTPS-only and response-size bounds are enforced by the host's guarded HTTP capability.
 */
import { GoogleWorkspaceError, backoffMs, capRetryAfterMs, classifyFailure, shouldRetryInline } from './request-policy.mjs';

const INVALID_JSON = Symbol('invalid-json');

/** Host connection refusals (Jini api-connections codes) → the plugin's safe codes. */
const HOST_TOKEN_CODES = new Map([
  ['reconnect-required', 'reconnect-required'], ['not-connected', 'not-connected'], ['connection-not-found', 'not-connected'],
  ['revocation-pending', 'not-connected'], ['account-changed', 'account-changed'],
  // The host's per-connection budget refused the token read: nothing was sent, so it is a quota wait.
  ['rate-limited', 'quota-delay'],
]);

/** The host's wait, through the same cap as Google's Retry-After; dropped when unusable. @complexity O(1). */
function hostRetryAfter(cause) {
  const retryAfterMs = capRetryAfterMs({ ms: cause?.retryAfterMs });
  return retryAfterMs === undefined ? {} : { retryAfterMs };
}

/**
 * A fresh access token from the host, read right before the request that uses it. A host refusal
 * becomes the matching safe error (`invalid_grant` surfaces here as `reconnect-required`; a form
 * delivery then fails at once and stays listed as failed); any other host error passes through
 * unchanged, since host errors never carry secrets.
 * @complexity O(1) plus the host's token read.
 */
export async function accessTokenFor(required, _optional = {}) {
  try {
    return await required.connections.getAccessToken({ connectionRef: required.connectionRef });
  } catch (cause) {
    const code = HOST_TOKEN_CODES.get(cause?.code);
    if (code) throw new GoogleWorkspaceError({ code }, { cause, ...hostRetryAfter(cause) });
    throw cause;
  }
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return INVALID_JSON; }
}

/**
 * One caller-supplied value as one encoded URL path segment.
 * @throws {GoogleWorkspaceError} `invalid-input` for an empty, `.` or `..` segment: URL parsing
 *   resolves those as dot segments and would move the request to another endpoint.
 * @complexity O(n) characters.
 */
export function pathSegment(required, _optional = {}) {
  const { value } = required;
  if (typeof value !== 'string' || value === '' || value === '.' || value === '..') throw new GoogleWorkspaceError({ code: 'invalid-input' });
  return encodeURIComponent(value);
}

/** `url` plus query parameters; an array value repeats the key (Sheets `ranges=`). @complexity O(q). */
export function buildUrl(required, _optional = {}) {
  const url = new URL(required.url);
  for (const [name, value] of Object.entries(required.query ?? {})) {
    for (const item of [value].flat()) url.searchParams.append(name, String(item));
  }
  return url.href;
}

function requestInit(request, token, signal) {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const body = request.body === undefined ? {} : { body: JSON.stringify(request.body) };
  if (request.body !== undefined) headers['content-type'] = 'application/json';
  return { method: request.method ?? 'GET', headers, ...body, ...(signal ? { signal } : {}) };
}

/** A 2xx body as JSON (empty = null), or the failure a non-2xx or unreadable answer becomes. @complexity O(response). */
async function readResponse(response, kind) {
  const text = await response.text();
  const body = text === '' ? null : parseJson(text);
  if (response.ok && body !== INVALID_JSON) return { ok: true, value: body };
  if (response.ok) return { ok: false, error: new GoogleWorkspaceError({ code: 'unexpected-response', outcome: kind === 'read' ? 'not-applied' : 'unknown' }) };
  return { ok: false, error: classifyFailure({ kind, status: response.status, body: body === INVALID_JSON ? undefined : body, retryAfterHeader: response.headers.get('retry-after') }) };
}

/**
 * Creates the client over the host capabilities a module received.
 * @param {{ http: { fetch(target: { url: string }, init?: RequestInit): Promise<Response> }, connections: { getAccessToken(input: { connectionRef: string }): Promise<string> } }} required
 * @param {{ sleep?: (ms: number) => Promise<void>, random?: () => number }} [optional]
 * @complexity O(attempts); each attempt is one token read (where the host charges its budgets) and one request (two after a 401).
 */
export function createGoogleClient(required, optional = {}) {
  const { http, connections } = required;
  const sleep = optional.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  /**
   * The token, or the host budget's refusal as a failed attempt: that refusal happens before
   * anything is sent, so it follows the same backoff rules as Google's 429 (even an append may
   * wait and retry). Every other host refusal ends the call.
   */
  async function tokenOrRefusal(connectionRef) {
    try {
      return { token: await accessTokenFor({ connections, connectionRef }) };
    } catch (error) {
      if (error instanceof GoogleWorkspaceError && error.code === 'quota-delay') return { error };
      throw error;
    }
  }

  /** One token read and at most one request; never resend a rejected token. @complexity O(1) plus response parsing. */
  async function attemptOnce(request, { signal, rejectedToken }) {
    const { token, error } = await tokenOrRefusal(request.connectionRef);
    if (error) return { ok: false, error, rejectedToken };
    if (token === rejectedToken) return { ok: false, error: new GoogleWorkspaceError({ code: 'reconnect-required' }) };
    let response;
    try {
      response = await http.fetch({ url: buildUrl(request) }, requestInit(request, token, signal));
    } catch (cause) {
      if (signal?.aborted) throw cause;
      return { ok: false, error: classifyFailure({ kind: request.kind, cause }), rejectedToken };
    }
    return { ...(await readResponse(response, request.kind)), unauthorized: response.status === 401, rejectedToken: response.status === 401 ? token : rejectedToken };
  }

  /**
   * One attempt, and one more with a different token when Google answered 401. Google refused a
   * 401 before acting, so even a `write` is safe to send again; a second 401 is final. Jini exposes
   * no plugin force-refresh option and can return a cached token, which must not be sent again.
   * @complexity O(1) attempts, at most two token reads and two requests.
   */
  async function attemptWithFreshToken(request, { signal, rejectedToken }) {
    const first = await attemptOnce(request, { signal, rejectedToken });
    return first.unauthorized ? attemptOnce(request, { signal, rejectedToken: first.rejectedToken }) : first;
  }

  return {
    /**
     * One Google API call with the policy's retries. Resolves the parsed JSON body.
     * @param {{ connectionRef: string, url: string, method?: string, query?: Record<string, string | number | boolean | readonly (string | number)[]>, body?: unknown, kind: 'read' | 'idempotent-write' | 'write' }} request
     * @param {{ signal?: AbortSignal }} [options]
     */
    async request(request, options = {}) {
      // One attempt, then (when the policy allows) a wait and the next attempt. Written as a bounded
      // recursion rather than an endless `for (;;)`: `shouldRetryInline` caps the attempts, so every
      // path ends in a return or a throw and there is no unreachable loop exit.
      // A host quota wait must not let a later attempt reuse a token Google already rejected, so the
      // rejected token is carried into the next attempt.
      const attemptFrom = async (attempt, rejectedToken) => {
        const result = await attemptWithFreshToken(request, { signal: options.signal, rejectedToken });
        if (result.ok) return result.value;
        const delayMs = backoffMs({ attempt, retryAfterMs: result.error.retryAfterMs }, optional.random ? { random: optional.random } : {});
        if (!shouldRetryInline({ error: result.error, attempt, delayMs })) throw result.error;
        await sleep(delayMs);
        return attemptFrom(attempt + 1, result.rejectedToken);
      };
      return attemptFrom(0, undefined);
    },
  };
}
