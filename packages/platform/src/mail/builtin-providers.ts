/**
 * @file The two built-in mail providers: `smtp` (any mailbox/relay) and `console` (local only).
 *
 * SMTP gets its transport from the host (nodemailer is never loaded by this package); console hands
 * each message to an explicit host preview (including sign-in/confirmation links) and reports
 * `hosted: false`, so it can never make a site look configured.
 */
import { nowIso, type Clock } from "@jini-ai/core/primitives";
import { effectivePort } from "../core/effective-port.js";
import type { MailAdapterCredential } from "./adapter-module.js";
import type { MailerPort } from "./ports.js";
import type { MailProviderModule } from "./provider.js";
import { SmtpMailerAdapter } from "./smtp.js";
import { type SmtpTransport } from "@jini-ai/core/contracts/mail";
import type { OutboundEmail } from './types.js';

/**
 * SMTP endpoint packed into a credential `baseUrl` (`https://host:port`); 443/465 = implicit TLS.
 * @complexity O(1).
 */
export function parseSmtpEndpoint({ baseUrl }: { baseUrl: string }): { host: string; port: number; secure: boolean } {
  const url = new URL(baseUrl);
  const port = effectivePort({ url });
  return { host: url.hostname, port, secure: port === 443 || port === 465 };
}

export function createSmtpMailProvider(required: {
  createTransport: (required: { host: string; port: number; secure: boolean; auth: { user: string; pass: string } }) => SmtpTransport;
  clock: Clock;
}): MailProviderModule {
  return {
    id: "smtp",
    label: "SMTP server",
    credentialKeys: ["baseUrl", "username", "token"],
    capabilities: { hosted: true, feedback: false, domainVerification: false },
    create({ credential }: { credential: MailAdapterCredential }): MailerPort {
      const endpoint = parseSmtpEndpoint({ baseUrl: credential.baseUrl ?? "" });
      const transport = required.createTransport({ ...endpoint, auth: { user: credential.username ?? "", pass: credential.token } });
      return new SmtpMailerAdapter({ transport, clock: required.clock });
    },
  };
}

/** No email is delivered locally: the preview must expose usable sign-in and confirmation links.
 * Local mail receipts require the host preview to accept the complete message first.
 * Preview errors propagate; no receipt claims a message was previewed when the host failed.
 * @complexity O(1) per message beyond the host callback; batches remain sequential. */
export function createConsoleMailProvider(
  required: { clock: Clock; preview: (required: { message: OutboundEmail }) => void | Promise<void> },
  _optional: Record<string, never> = {},
): MailProviderModule {
  if (typeof required.preview !== 'function') throw new TypeError('A local mail preview callback is required.');
  let counter = 0;
  const mailer: MailerPort = {
    capabilities: () => ({ driver: "console", supportsIdempotencyKey: false, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: true }),
    async send({ message }) {
      const receipt = ++counter;
      // This is intentional mail delivery to a host preview, separate from safe diagnostics.
      await required.preview({ message });
      return { ok: true, providerMessageId: `console-${receipt}`, acceptedAt: nowIso({ clock: required.clock }) };
    },
    async sendBatch({ messages, ...delivery }) {
      const results = [];
      for (const message of messages) results.push(await mailer.send({ ...delivery, message }));
      return results;
    },
  };
  return {
    id: "console",
    label: "Console (local development, sends nothing)",
    credentialKeys: [],
    capabilities: { hosted: false, feedback: false, domainVerification: false },
    create: () => mailer,
  };
}
