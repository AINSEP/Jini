// @ts-check
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * @file Resend delivery feedback: Svix webhook signature check and event normalization
 * (Jini `MailFeedbackParser`). Neither function throws; a bad input is `false` or `{ error }`.
 *
 * Svix signs `${svix-id}.${svix-timestamp}.${raw body}` with HMAC-SHA256 under the base64 key after
 * the `whsec_` prefix, and sends space-separated `v1,<base64>` signatures (several while Resend
 * rotates its own key). Any of our `secrets` may match, so the operator can rotate theirs too.
 * `sourceContext.module` is `unknown`: sends carry no Resend tags yet, so the originating module is
 * not in the payload; suppression does not need it.
 *
 * @typedef {{ workspaceId: string, providerMessageId: string, sourceContext: { module: string },
 *   kind: 'delivered' | 'bounced' | 'complained', eventId: string, recipient: string, hardBounce: boolean,
 *   occurredAt: string }} FeedbackEvent
 */

/** Svix's replay window: a captured request older (or newer) than this is refused. */
export const SVIX_TOLERANCE_SECONDS = 5 * 60;

/** Resend event type to normalized kind; every other type (sent, opened, clicked, delayed) is ignored. */
const KINDS = /** @type {const} */ ({ 'email.bounced': 'bounced', 'email.complained': 'complained', 'email.delivered': 'delivered' });

/** @param {string} secret @returns {Buffer} */
function secretKey(secret) {
  return Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64');
}

/** The `v1` signatures of a `svix-signature` header, decoded. @param {string} header @returns {Buffer[]} */
function v1Signatures(header) {
  return header.split(' ').map((entry) => entry.split(',')).filter(([version, value]) => version === 'v1' && value)
    .map(([, value]) => Buffer.from(/** @type {string} */ (value), 'base64'));
}

/** Constant-time compare; differing lengths never match. @param {Buffer} a @param {Buffer} b */
function sameBytes(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {{ rawBody: Uint8Array, headers: Readonly<Record<string, string>>, secrets: readonly string[], now: number }} required
 * @returns {boolean}
 */
export function verify({ rawBody, headers, secrets, now }) {
  try {
    const id = headers['svix-id'];
    const timestamp = headers['svix-timestamp'];
    const signature = headers['svix-signature'];
    if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
    if (Math.abs(now / 1000 - Number(timestamp)) > SVIX_TOLERANCE_SECONDS) return false;
    const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), Buffer.from(rawBody)]);
    const offered = v1Signatures(signature);
    return secrets.some((secret) => {
      const expected = createHmac('sha256', secretKey(secret)).update(signed).digest();
      return offered.some((candidate) => sameBytes(candidate, expected));
    });
  } catch {
    return false;
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Resend's `bounce.type`: `Permanent` (or `hard`) is a hard bounce; `Transient`/`Undetermined` are not. @param {any} data */
function isHardBounce(data) {
  const type = isObject(data.bounce) ? String(data.bounce.type ?? '').toLowerCase() : '';
  return type === 'permanent' || type === 'hard';
}

/** @param {unknown} to @returns {string[]} */
function recipientsOf(to) {
  const list = Array.isArray(to) ? to : [to];
  return list.filter((entry) => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim().toLowerCase());
}

/** A non-empty string, else undefined. @param {unknown} value */
const nonEmpty = (value) => (typeof value === 'string' && value !== '' ? value : undefined);

/**
 * The event id: Svix's `svix-id` (stable across its retries of one message), else the payload's own
 * `id`, else a hash of the exact bytes (a retry resends identical bytes, so it hashes the same) for a
 * host that passes no headers. Per recipient, so one event to many stays unique in the inbox.
 * @param {any} payload @param {Uint8Array} rawBody @param {Readonly<Record<string, string>> | undefined} headers
 */
function baseIdOf(payload, rawBody, headers) {
  return nonEmpty(headers?.['svix-id']) ?? nonEmpty(payload.id) ?? createHash('sha256').update(rawBody).digest('hex');
}

/**
 * @param {{ rawBody: Uint8Array, workspaceId: string, headers?: Readonly<Record<string, string>> }} required
 * @returns {readonly FeedbackEvent[] | { error: string }}
 */
export function parse({ rawBody, workspaceId, headers }) {
  let payload;
  try {
    payload = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch {
    return { error: 'body is not JSON' };
  }
  if (!isObject(payload) || typeof payload.type !== 'string' || !isObject(payload.data)) return { error: 'not a Resend webhook event' };
  const kind = KINDS[/** @type {keyof typeof KINDS} */ (payload.type)];
  if (!kind) return [];
  const { data } = payload;
  const recipients = recipientsOf(data.to);
  const occurredAt = String(payload.created_at ?? data.created_at ?? new Date().toISOString());
  const base = baseIdOf(payload, rawBody, headers);
  return recipients.map((recipient) => ({
    workspaceId, providerMessageId: typeof data.email_id === 'string' ? data.email_id : '', sourceContext: { module: 'unknown' },
    kind, eventId: recipients.length > 1 ? `${base}:${recipient}` : base, recipient,
    hardBounce: kind === 'bounced' && isHardBounce(data), occurredAt,
  }));
}

export const feedback = { verify, parse };
