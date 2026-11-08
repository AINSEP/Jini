import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { MailAdapterCredential, MailProviderModule, MailerPort, PositionalMailer } from "@jini-ai/core/contracts/mail";
import { credentialSecrets, safeMailProviderText } from "./provider-error.js";
import { fromPositionalMailer, toPositionalMailer } from "./plugin-abi.js";
/**
 * Builds a provider's mailer with credential scrubbing inside every policy wrapper.
 * @complexity O(1).
 */
export function createProviderMailer(
  required: { httpClient: HttpClientPort; provider: MailProviderModule; credential: MailAdapterCredential },
  _optional: Record<string, never> = {}
): MailerPort {
  const { httpClient, provider, credential } = required;
  const mailer = toPositionalMailer({ mailer: provider.create({ credential, kit: { httpClient } }) });
  const secrets = credentialSecrets({ credential });
  const safeResult = (result: Awaited<ReturnType<PositionalMailer["send"]>>) => result.ok ? result : {
    ...result,
    errorCode: safeMailProviderText({ text: result.errorCode }, { secrets }),
    message: safeMailProviderText({ text: result.message }, { secrets }),
  };
  // Policy turns throws into unknown outcomes; scrub here while the actual credential is in scope.
  const safeCall = async <T>(call: () => Promise<T>): Promise<T> => {
    try { return await call(); } catch (error) {
      throw new Error(safeMailProviderText({ text: error instanceof Error ? error.message : String(error) }, { secrets }));
    }
  };
  return fromPositionalMailer({ mailer: {
    capabilities: () => mailer.capabilities(),
    send: async (message, options) => safeResult(await safeCall(() => mailer.send(message, options))),
    sendBatch: async (messages, options) => (await safeCall(() => mailer.sendBatch(messages, options))).map(safeResult),
  } });
}
