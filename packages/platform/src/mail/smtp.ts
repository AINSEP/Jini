/** SMTP adapter over an injected transport and clock; no SMTP vendor is loaded by core. */

import { nowIso, type Clock as ClockPort } from "@jini-ai/core/primitives";
import type { MailerPort } from "./ports.js";
import type { EmailAddress, MailerCapabilities, MailerSendOptions, MailerSendResult, OutboundEmail, MailerSendRequired, MailerBatchRequired, MailerOptional } from "./types.js";

export interface SmtpTransport {
  // Keep the vendor behind a structural seam so delivery rules can run without a real SMTP socket.
  sendMail(required: { mail: SmtpMailPayload }): Promise<{ messageId: string }>;
}

export interface SmtpMailPayload {
  from: { name?: string; address: string };
  to: { name?: string; address: string };
  replyTo?: { name?: string; address: string };
  subject: string;
  html?: string;
  text?: string;
  headers?: Readonly<Record<string, string>>;

  // The vendor expects a mutable attachment array; send constructs a fresh one, so no caller-owned
  // array is exposed to mutation. A local payload type also keeps fakes independent of vendor types.
  attachments?: { filename: string; content: string; encoding: "base64"; contentType: string }[];
}

function toNodemailerAddress(address: EmailAddress): { name?: string; address: string } {
  // Object addresses delegate header-safe display-name quoting/encoding to the SMTP library.
  return address.name ? { name: address.name, address: address.email } : { address: address.email };
}

const NON_RETRYABLE_SMTP_CODES = new Set(["EAUTH", "EENVELOPE", "EMESSAGE"]);

function classifySmtpError(err: unknown): MailerSendResult {
  // Prefer the server's RFC 5321 reply: 4xx asks for retry, 5xx rejects the message as-is.
  // Pre-response auth/envelope/content rejection is terminal; connection failures are transient.
  // Unknown failures remain retryable to avoid silently dropping mail on an unfamiliar error shape.
  const message = err instanceof Error ? err.message : String(err);
  const responseCode = hasNumericField(err, "responseCode") ? err.responseCode : undefined;
  if (responseCode !== undefined) {
    const retryable = responseCode >= 400 && responseCode < 500;
    return { ok: false, retryable, errorCode: `SMTP_${responseCode}`, message };
  }

  const code = hasStringField(err, "code") ? err.code : undefined;
  if (code !== undefined) {

    return { ok: false, retryable: !NON_RETRYABLE_SMTP_CODES.has(code), errorCode: code, message };
  }
  return { ok: false, retryable: true, errorCode: "SMTP_UNKNOWN_ERROR", message };
}

function hasNumericField<K extends string>(value: unknown, key: K): value is Record<K, number> {
  return typeof value === "object" && value !== null && key in value && typeof (value as Record<K, unknown>)[key] === "number";
}

function hasStringField<K extends string>(value: unknown, key: K): value is Record<K, string> {
  return typeof value === "object" && value !== null && key in value && typeof (value as Record<K, unknown>)[key] === "string";
}

export class SmtpMailerAdapter implements MailerPort {
  private readonly clock: ClockPort;

  private readonly transport: SmtpTransport;
  constructor({ transport, clock }: { transport: SmtpTransport; clock: ClockPort }) {
    // Inject acceptance time so delivery outcomes can be checked deterministically without wall-clock I/O.
    this.transport = transport; this.clock = clock;
  }

  capabilities(_required: Record<string, never>): MailerCapabilities {
    return {
      driver: "smtp",

      // SMTP has no dedup-key verb; a caller needs its own send ledger to prevent duplicate delivery.
      supportsIdempotencyKey: false,

      // Bounce/complaint feedback requires a separately configured return-path mailbox parser.
      supportsWebhookFeedback: false,

      maxBatchSize: 1,
      supportsAttachments: true,
    };
  }

  async send({ message }: MailerSendRequired, _optional: MailerOptional = {}): Promise<MailerSendResult> {
    try {
      const info = await this.transport.sendMail({ mail: {
        from: toNodemailerAddress(message.from),
        to: toNodemailerAddress(message.to),
        ...(message.replyTo ? { replyTo: toNodemailerAddress(message.replyTo) } : {}),
        subject: message.subject,
        ...(message.html !== undefined ? { html: message.html } : {}),
        ...(message.text !== undefined ? { text: message.text } : {}),
        ...(message.headers ? { headers: message.headers } : {}),
        ...(message.attachments && message.attachments.length > 0
          ? {
              attachments: message.attachments.map((attachment) => ({
                filename: attachment.filename,
                content: attachment.contentBase64,
                encoding: "base64" as const,
                contentType: attachment.contentType,
              })),
            }
          : {}),
      } });
      return { ok: true, providerMessageId: info.messageId, acceptedAt: nowIso({ clock: this.clock }) };
    } catch (err) {
      return classifySmtpError(err);
    }
  }

  async sendBatch(
    { messages, ...required }: MailerBatchRequired,
    optional: MailerOptional = {}
  ): Promise<readonly MailerSendResult[]> {
    const results: MailerSendResult[] = [];
    // SMTP has no native batch verb; sequential sends preserve one outcome per input message.
    for (const message of messages) {
      results.push(await this.send({ message, ...required }, optional));
    }
    return results;
  }
}

export interface CreateNodemailerSmtpTransportConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  nodemailer: NodemailerPort;
}

export function createNodemailerSmtpTransport(config: CreateNodemailerSmtpTransportConfig, { timeoutMs }: { timeoutMs?: number } = {}): SmtpTransport {
  // Delegate SMTP negotiation/authentication to the vendor rather than reimplementing the protocol.

  const nodemailer = config.nodemailer;
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    ...(timeoutMs === undefined ? {} : { connectionTimeout: timeoutMs }),
  });
  return {
    sendMail: async ({ mail }) => {
      const info = await transporter.sendMail(mail);
      return { messageId: info.messageId };
    },
  };
}

/** A host can pass nodemailer's module structurally; this package never loads or requires it. */
export interface NodemailerPort {
  createTransport(required: { host: string; port: number; secure: boolean; auth: { user: string; pass: string }; connectionTimeout?: number }): NativeSmtpTransport;
}

/** Vendor-shaped adapter boundary; application mailers use SmtpTransport. */
export interface NativeSmtpTransport {
  sendMail(mail: SmtpMailPayload): Promise<{ messageId: string }>;
}
