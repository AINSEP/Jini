import type { MailerPort, PositionalMailer, PluginMailHttpClient } from "@jini-ai/core/contracts/mail";
import type { HttpClientPort } from "@jini-ai/core/primitives";
export type { PositionalMailer, PluginMailHttpClient } from "@jini-ai/core/contracts/mail";
/** Preserve the guarded client while translating the plugin's positional request. @complexity O(1). */
export function toPluginHttpClient({ httpClient }: { httpClient: HttpClientPort }, _optional: Record<string, never> = {}): PluginMailHttpClient {
  return { send: (request, optional) => httpClient.send({ request }, optional) };
}
/** Adapts required delivery fields and optional controls to a positional mailer. */
export function fromPositionalMailer({ mailer }: { mailer: PositionalMailer }, _optional: Record<string,never> = {}): MailerPort {
  return {
    capabilities: () => mailer.capabilities(),
    send: ({ message, ...required }, optional = {}) => mailer.send(message, { ...required, ...optional }),
    sendBatch: ({ messages, ...required }, optional = {}) => mailer.sendBatch(messages, { ...required, ...optional }),
  };
}

/** Adapts an object-shaped mailer for positional consumers, preserving all delivery controls. */
export function toPositionalMailer({ mailer }: { mailer: MailerPort }, _optional: Record<string,never> = {}): PositionalMailer {
  return {
    capabilities: () => mailer.capabilities({}),
    send: (message, { idempotencyKey, workspaceId, sourceContext, ...optional }) =>
      mailer.send({ message, idempotencyKey, workspaceId, sourceContext }, optional),
    sendBatch: (messages, { idempotencyKey, workspaceId, sourceContext, ...optional }) =>
      mailer.sendBatch({ messages, idempotencyKey, workspaceId, sourceContext }, optional),
  };
}

