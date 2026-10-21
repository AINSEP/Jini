/**
 * @file The two built-in mail providers: `smtp` (any mailbox/relay) and `console` (local only).
 *
 * SMTP gets its transport from the host (nodemailer is never loaded by this package); console logs
 * and reports `hosted: false`, so it can never make a site look configured.
 */
import { nowIso, type Clock } from "@jini-ai/core/primitives";
import type { MailAdapterCredential } from "./adapter-module.js";
import type { MailerPort } from "./ports.js";
import type { MailProviderModule } from "./provider.js";
import { SmtpMailerAdapter, type SmtpTransport } from "./smtp.js";

/**
 * SMTP endpoint packed into a credential `baseUrl` (`https://host:port`); 443/465 = implicit TLS.
 * @complexity O(1).
 */
export function parseSmtpEndpoint({ baseUrl }: { baseUrl: string }): { host: string; port: number; secure: boolean } {
  const url = new URL(baseUrl);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
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

export function createConsoleMailProvider(
  required: { clock: Clock },
  optional: { log?: (line: string) => void } = {},
): MailProviderModule {
  const log = optional.log ?? ((line: string) => console.log(line));
  let counter = 0;
  const mailer: MailerPort = {
    capabilities: () => ({ driver: "console", supportsIdempotencyKey: false, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: true }),
    async send({ message }) {
      counter += 1;
      log(`[mail:console] to=${message.to.email} subject=${JSON.stringify(message.subject)}`);
      return { ok: true, providerMessageId: `console-${counter}`, acceptedAt: nowIso({ clock: required.clock }) };
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
