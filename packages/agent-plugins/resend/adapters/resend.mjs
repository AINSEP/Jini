// @ts-check
import { parseErrorBody } from '../lib/errors.mjs';
import { domainRequirements, domainStatus, retryAfterMs } from '../lib/domains.mjs';
import { feedback } from '../lib/feedback.mjs';

/**
 * @file Resend mail adapter for the `resend` Agent Plugin.
 *
 * Moved out of core (`apps/website/src/platform/mail/adapters/http-api.resend.ts`) unchanged in
 * behavior: same request, same error mapping, same batch strategy. Core now knows only the generic
 * mail-adapter contract (`apps/website/src/platform/mail/adapter-module.ts`); it loads this file
 * through its mail-adapter registry and hands it the guarded outbound-HTTP client, so every request
 * still goes through the host's egress policy. Plain JS, no npm imports: an installed plugin has none.
 *
 * Why a hosted API is the recommended mailer: outbound SMTP (587/465) is blocked or throttled by most
 * residential ISPs and cloud providers, while HTTPS always works, and a provider API gives warmed
 * sending IPs plus bounce/complaint webhooks (the only thing that can ever fill the suppression ledger).
 *
 * `sendBatch` loops `send()` rather than calling Resend's `/emails/batch`: the mail port requires
 * per-message results with partial failure allowed, and Resend's batch endpoint reports success or
 * failure for the whole request only. `maxBatchSize` is `1` accordingly.
 *
 * The default export is a full Jini `MailProviderModule` (2026-10-21): id, credential keys,
 * capabilities (Resend's documented 2 requests/second default), the Svix feedback parser
 * (`../lib/feedback.mjs`) and sending-domain verification (`../lib/domains.mjs`). `create()` keeps its
 * original call shape (`send(message, opts)`), which the host's mailer still uses.
 *
 * @typedef {{ email: string, name?: string }} EmailAddress
 * @typedef {{ filename: string, contentType: string, contentBase64: string }} EmailAttachment
 * @typedef {{ to: EmailAddress, from: EmailAddress, replyTo?: EmailAddress, subject: string, html?: string,
 *   text?: string, headers?: Readonly<Record<string, string>>, attachments?: readonly EmailAttachment[] }} OutboundEmail
 * @typedef {{ idempotencyKey: string, timeoutMs?: number }} SendOptions
 * @typedef {{ ok: true, providerMessageId: string, acceptedAt: string }
 *   | { ok: false, retryable: boolean, errorCode: string, message: string, retryAfterMs?: number }} SendResult
 * @typedef {{ send(request: { method: string, url: string, headers: Record<string, string>, body?: string,
 *   timeoutMs: number }): Promise<{ status: number, bodyText: string, headers?: Readonly<Record<string, string>> }> }} HttpClient
 * @typedef {{ credential: { token: string, baseUrl?: string }, kit: { httpClient: HttpClient } }} CreateContext
 */

/** Resend's real API origin; a saved credential's `baseUrl` normally equals it. */
const DEFAULT_BASE_URL = "https://api.resend.com";

/** Bounds a hung request; a caller's own `timeoutMs` wins. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** `EmailAddress` to Resend's `"Name <email>"` / bare-email string. @param {EmailAddress} address */
function formatAddress(address) {
  return address.name ? `${address.name} <${address.email}>` : address.email;
}

/** Resend's attachment shape (snake_case, base64 in `content`). @param {EmailAttachment} attachment */
function toResendAttachment(attachment) {
  return { filename: attachment.filename, content: attachment.contentBase64, content_type: attachment.contentType };
}

/** The JSON body of `POST /emails`. @param {OutboundEmail} message @returns {Record<string, unknown>} */
function toResendPayload(message) {
  /** @type {Record<string, unknown>} */
  const payload = { from: formatAddress(message.from), to: formatAddress(message.to), subject: message.subject };
  if (message.replyTo) payload.reply_to = formatAddress(message.replyTo);
  if (message.html !== undefined) payload.html = message.html;
  if (message.text !== undefined) payload.text = message.text;
  if (message.headers) payload.headers = message.headers;
  if (message.attachments && message.attachments.length > 0) payload.attachments = message.attachments.map(toResendAttachment);
  return payload;
}

/** Transient per Resend's error reference: rate limit, idempotency conflict, server outage. @param {number} status */
function isRetryableStatus(status) {
  return status === 429 || status === 409 || status >= 500;
}

/** Shared mail contract's throttling code (`@jini-ai/platform/mail` `MAIL_RATE_LIMITED`); a literal,
 * since an installed plugin has no npm imports. Callers defer it instead of failing the recipient. */
const MAIL_RATE_LIMITED = "MAIL_RATE_LIMITED";

/**
 * Maps a non-2xx response to a send result. Never throws.
 * A 429 carries Resend's `Retry-After` as `retryAfterMs` so the caller backs off for that long, and is
 * normalized to {@link MAIL_RATE_LIMITED} (Resend's own name kept in the message) so it is deferred,
 * not recorded as a failed recipient.
 * @param {number} status @param {string} bodyText @param {Readonly<Record<string, string>>} [headers] @returns {SendResult}
 */
function classifyError(status, bodyText, headers) {
  const { errorCode, message } = parseErrorBody({ status, bodyText });
  if (status !== 429) return { ok: false, retryable: isRetryableStatus(status), errorCode, message };
  const wait = retryAfterMs(headers);
  return { ok: false, retryable: true, errorCode: MAIL_RATE_LIMITED, message: `${message} (${errorCode})`, ...(wait === undefined ? {} : { retryAfterMs: wait }) };
}

/** Builds the mailer from a saved credential. @param {CreateContext} context */
function create({ credential, kit }) {
  const baseUrl = credential.baseUrl || DEFAULT_BASE_URL;
  const { httpClient } = kit;

  /** @param {OutboundEmail} message @param {SendOptions} opts @returns {Promise<SendResult>} */
  async function send(message, opts) {
    let response;
    try {
      response = await httpClient.send({
        method: "POST",
        url: `${baseUrl}/emails`,
        headers: {
          Authorization: `Bearer ${credential.token}`,
          "content-type": "application/json",
          "Idempotency-Key": opts.idempotencyKey,
        },
        body: JSON.stringify(toResendPayload(message)),
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
    } catch (err) {
      // Network failure, timeout or an egress-policy refusal: retryable, and never thrown across
      // the mail port.
      return { ok: false, retryable: true, errorCode: "TRANSPORT_ERROR", message: err instanceof Error ? err.message : String(err) };
    }
    if (response.status < 200 || response.status >= 300) return classifyError(response.status, response.bodyText, response.headers);

    let parsed;
    try {
      parsed = JSON.parse(response.bodyText);
    } catch {
      // HTTP acceptance still stands if a proxy strips or corrupts the optional response body.
      // Keep the existing idempotency-key fallback so this batch can continue without resending.
    }
    const providerMessageId = typeof parsed?.id === "string" ? parsed.id : opts.idempotencyKey;
    return { ok: true, providerMessageId, acceptedAt: new Date().toISOString() };
  }

  return {
    capabilities() {
      // Resend honours `Idempotency-Key` (24h window) and emits bounce/complaint webhooks.
      return { driver: "resend", supportsIdempotencyKey: true, supportsWebhookFeedback: true, maxBatchSize: 1, supportsAttachments: true };
    },
    send,
    /** @param {readonly OutboundEmail[]} messages @param {SendOptions} opts */
    async sendBatch(messages, opts) {
      /** @type {SendResult[]} */
      const results = [];
      for (const [index, message] of messages.entries()) {
        // One key per message: reusing the batch key would make messages 2..n look like retries of
        // message 1 to Resend. `:index` is deterministic, so a redelivery reproduces the same keys.
        results.push(await send(message, { ...opts, idempotencyKey: `${opts.idempotencyKey}:${index}` }));
      }
      return results;
    },
  };
}

export default {
  id: 'resend',
  label: 'Resend',
  // Sending access cannot read domains; the plugin's separate account key can.
  domainReadConnection: { serverId: 'resend', baseUrl: DEFAULT_BASE_URL },
  credentialKeys: ['token'],
  webhookSecretKey: 'webhookSecret',
  capabilities: { hosted: true, feedback: true, domainVerification: true, rateLimit: { perSecond: 2, burst: 2 } },
  create,
  feedback,
  domainRequirements,
  domainStatus,
};
