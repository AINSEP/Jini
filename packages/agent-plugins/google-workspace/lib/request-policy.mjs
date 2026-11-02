/**
 * @file Google request policy for the Google Workspace plugin: the safe error every failure becomes,
 * whether a failed request may be retried and how long to wait. The per-minute budgets themselves
 * are declared in `tovu-connections.json` and enforced by the host on every token read.
 *
 * Exists so chat tools, admin actions and form delivery share ONE answer to "may this run again?"
 * and one error vocabulary. Errors never carry tokens, Google's own message text or sheet contents:
 * Google echoes ranges and values in its messages, so only a fixed sentence per code is shown.
 */

/** Longest wait spent inside one call; a longer Retry-After is returned to the caller instead. */
export const MAX_INLINE_WAIT_MS = 10_000;
export const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_RETRY_AFTER_MS = 15 * 60_000;

/** Every safe code: whether a retry can help, what the person does next, and the fixed sentence. */
const SAFE_ERRORS = Object.freeze({
  'invalid-request': { retryable: false, nextAction: 'fix-request', message: 'Google rejected the request as invalid. Check the spreadsheet, tab, range and values, then try again.' },
  'not-connected': { retryable: false, nextAction: 'connect', message: 'Google Workspace is not connected. Connect it from the Google Workspace plugin, then retry.' },
  'reconnect-required': { retryable: false, nextAction: 'reconnect', message: 'Reconnect required: Google no longer accepts the saved sign-in. Reconnect Google Workspace, then retry.' },
  'account-changed': { retryable: false, nextAction: 'review-account', message: 'The connected Google account changed since this was confirmed. Review the account and confirm again.' },
  'missing-permission': { retryable: false, nextAction: 'grant-permission', message: 'The connected Google account has not granted a permission this needs. Reconnect and allow every requested permission.' },
  'file-not-granted': { retryable: false, nextAction: 're-pick-file', message: 'This site cannot open this file with the connected Google account. Choose it again with the file picker, or create a new spreadsheet.' },
  'access-denied': { retryable: false, nextAction: 're-pick-file', message: 'Google refused access to this file for the connected account. Check that the account can edit it, then choose it again.' },
  'admin-policy': { retryable: false, nextAction: 'contact-admin', message: "A Google Workspace administrator's policy blocks this. Ask the administrator to allow this site, then retry." },
  'conflict': { retryable: true, nextAction: 'retry-later', message: 'Google reported a conflicting change. Retry in a moment.' },
  'quota-delay': { retryable: true, nextAction: 'retry-later', message: 'Google asked this site to slow down. Nothing was lost; retry after the delay.' },
  'service-unavailable': { retryable: true, nextAction: 'retry-later', message: 'Google is temporarily unavailable. Nothing was lost; retry later.' },
  'network-error': { retryable: true, nextAction: 'retry-later', message: 'This site could not reach Google. Check the connection and retry later.' },
  'uncertain-outcome': { retryable: false, nextAction: 'review-outcome', message: 'Google did not confirm whether the change was applied. Check the spreadsheet before trying again.' },
  'unexpected-response': { retryable: false, nextAction: 'report', message: 'Google returned a response this site does not understand. Report this to the plugin author.' },
  'product-disabled': { retryable: false, nextAction: 'enable-product', message: 'This Google product is turned off. Turn it on in the Google Workspace panel, then retry; the Google sign-in is kept.' },
  'picker-not-configured': { retryable: false, nextAction: 'contact-admin', message: "Choosing an existing spreadsheet is not set up on this site yet (the Google file picker is not configured). Add this site's Google Picker browser key and app ID, or create a new spreadsheet." },
  'invalid-selection': { retryable: false, nextAction: 're-pick-file', message: 'The file picker returned a selection this site cannot use. Choose the spreadsheet again.' },
  'not-a-spreadsheet': { retryable: false, nextAction: 're-pick-file', message: 'The chosen file is not a Google Sheets spreadsheet. Choose a spreadsheet, or create a new one.' },
  // Refused by the plugin before anything was sent to Google (bounds and input checks of the Sheets tools).
  'invalid-input': { retryable: false, nextAction: 'fix-request', message: 'This request is not valid for the tool. Check the spreadsheet id, tab, range and options, then try again. Nothing was sent to Google.' },
  'limit-exceeded': { retryable: false, nextAction: 'narrow-request', message: 'This request or its result is larger than the tool allows. Ask for a smaller range, fewer rows or fewer entries, then try again.' },
  'export-unavailable': { retryable: false, nextAction: 'read-in-chat', message: 'Saving a CSV file is not available on this site. Nothing was read from Google; read the values in chat instead (sheets_values_get or sheets_values_batch_get).' },
  'unsupported-request': { retryable: false, nextAction: 'fix-request', message: 'The batch contains a request kind Google Workspace tools do not support (only reviewed, generally available Sheets request kinds are allowed). Remove it and retry; nothing was sent to Google.' },
});

/** A failure a person can act on. `outcome` says whether the request may have changed anything. */
export class GoogleWorkspaceError extends Error {
  /**
   * @param {{ code: keyof typeof SAFE_ERRORS, outcome?: 'not-applied' | 'unknown' }} required
   * @param {{ retryAfterMs?: number, cause?: unknown, detail?: string }} [optional] `detail` is a
   *   short pointer the plugin itself composes (a request index, a kind name it validated); never
   *   Google's text, a token or a cell value.
   */
  constructor(required, optional = {}) {
    const safe = SAFE_ERRORS[required.code];
    const message = optional.detail === undefined ? safe.message : `${safe.message} (${optional.detail})`;
    super(message, optional.cause === undefined ? undefined : { cause: optional.cause });
    this.name = 'GoogleWorkspaceError';
    this.code = required.code;
    this.retryable = safe.retryable;
    this.nextAction = safe.nextAction;
    this.outcome = required.outcome ?? 'not-applied';
    if (optional.retryAfterMs !== undefined) this.retryAfterMs = optional.retryAfterMs;
  }

  /** The tool-output shape: never the cause, which may hold provider text. */
  toJSON() {
    const { code, message, retryable, outcome, nextAction, retryAfterMs } = this;
    return { code, message, retryable, outcome, nextAction, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
  }
}

/** Google's machine-readable reasons (Drive `errors[].reason`, Sheets `details[].reason`) → code. */
const REASON_CODES = new Map([
  ['rateLimitExceeded', 'quota-delay'], ['userRateLimitExceeded', 'quota-delay'], ['RATE_LIMIT_EXCEEDED', 'quota-delay'],
  ['insufficientPermissions', 'missing-permission'], ['ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'missing-permission'],
  ['appNotAuthorizedToFile', 'file-not-granted'], ['domainPolicy', 'admin-policy'],
]);
const STATUS_CODES = new Map([
  [400, 'invalid-request'], [401, 'reconnect-required'], [403, 'access-denied'], [404, 'file-not-granted'],
  [409, 'conflict'], [412, 'conflict'], [413, 'invalid-request'], [429, 'quota-delay'],
]);

/** The reasons named in a Google error body; a body that is not Google's shape names none. @complexity O(r). */
export function errorReasons(required, _optional = {}) {
  const error = required.body?.error;
  if (typeof error !== 'object' || error === null) return [];
  const listed = [...(Array.isArray(error.errors) ? error.errors : []), ...(Array.isArray(error.details) ? error.details : [])];
  return listed.map((entry) => entry?.reason).filter((reason) => typeof reason === 'string');
}

/**
 * Retry-After as milliseconds (delta-seconds or an HTTP date), capped; undefined when absent or unusable.
 * @complexity O(1).
 */
export function parseRetryAfter(required, optional = {}) {
  const raw = required.header?.trim();
  if (!raw) return undefined;
  const nowMs = optional.nowMs ?? Date.now();
  const ms = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - nowMs;
  return capRetryAfterMs({ ms });
}

/**
 * A wait in milliseconds, capped; undefined when it is not a finite, non-negative number. Shared by
 * Google's Retry-After and the host's budget refusal so both obey one ceiling.
 * @complexity O(1).
 */
export function capRetryAfterMs(required, _optional = {}) {
  const { ms } = required;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : undefined;
}

/**
 * The safe code for an HTTP failure: a known reason wins, then the status, then 5xx → unavailable.
 * @complexity O(r) reasons.
 */
export function codeForStatus(required, _optional = {}) {
  const fromReason = required.reasons.map((reason) => REASON_CODES.get(reason)).find(Boolean);
  if (fromReason) return fromReason;
  return STATUS_CODES.get(required.status) ?? (required.status >= 500 ? 'service-unavailable' : 'unexpected-response');
}

/**
 * Whether a failed request may have been applied. Only a non-read can be applied; 4xx means Google
 * refused it before acting, while a 5xx or a lost response leaves it unknown.
 * @complexity O(1).
 */
function outcomeFor(kind, status) {
  if (kind === 'read') return 'not-applied';
  return status !== undefined && status < 500 ? 'not-applied' : 'unknown';
}

/**
 * The safe error for one failed attempt. `kind` is `read`, `idempotent-write` (same request, same
 * result: values update/clear) or `write` (append, create, copy). An unknown outcome of a `write`
 * is `uncertain-outcome` and never retryable: replaying it could apply it twice.
 * @param {{ kind: 'read' | 'idempotent-write' | 'write', status?: number, body?: unknown, retryAfterHeader?: string | null, cause?: unknown }} required
 * @param {{ nowMs?: number }} [optional]
 * @complexity O(r) reasons.
 */
export function classifyFailure(required, optional = {}) {
  const { kind, status, cause } = required;
  const outcome = outcomeFor(kind, status);
  if (kind === 'write' && outcome === 'unknown') return new GoogleWorkspaceError({ code: 'uncertain-outcome', outcome }, { cause });
  const code = status === undefined ? 'network-error' : codeForStatus({ status, reasons: errorReasons({ body: required.body }) });
  const retryAfterMs = parseRetryAfter({ header: required.retryAfterHeader ?? undefined }, optional);
  return new GoogleWorkspaceError({ code, outcome }, { ...(retryAfterMs === undefined ? {} : { retryAfterMs }), ...(cause === undefined ? {} : { cause }) });
}

/**
 * Delay before attempt `attempt + 1`: full-jitter exponential backoff, never shorter than Google's
 * Retry-After.
 * @complexity O(1).
 */
export function backoffMs(required, optional = {}) {
  const random = optional.random ?? Math.random;
  const jittered = Math.round(random() * BASE_BACKOFF_MS * 2 ** required.attempt);
  return Math.max(required.retryAfterMs ?? 0, jittered);
}

/** Whether to wait and try again inside this call. @complexity O(1). */
export function shouldRetryInline(required, _optional = {}) {
  return required.error.retryable && required.attempt + 1 < MAX_ATTEMPTS && required.delayMs <= MAX_INLINE_WAIT_MS;
}
