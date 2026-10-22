/**
 * @file `verifyWebhook`: signature first, then the envelope, then the facts. Never throws — every
 * failure is a `rejected` Outcome, so a forged or garbled delivery is answered once and never
 * retried as `unknown`.
 */
import type { Outcome, ProviderContext, WebhookFact } from "@jini-ai/commerce/payments/kernel";
import { localRejection } from "./errors.js";
import { parseStripeEvent, stripeEventFacts } from "./events.js";
import { verifyStripeSignature } from "./signature.js";

/** Header lookup is case-insensitive: Node lowercases header names, other hosts may not. */
function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
}

function parseJson(rawBody: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody)) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Verify and translate one delivery.
 * @param required.toleranceSec - Replay window in seconds.
 * @complexity O(n) in the body size.
 */
export async function verifyStripeWebhook(
  { rawBody, headers, ctx, toleranceSec }: { rawBody: Uint8Array; headers: Readonly<Record<string, string>>; ctx: ProviderContext; toleranceSec: number },
  _optional: Record<string, never> = {}
): Promise<Outcome<readonly WebhookFact[]>> {
  const verdict = verifyStripeSignature({
    rawBody,
    header: headerValue(headers, "stripe-signature"),
    secrets: [ctx.credentials.webhookSecret, ctx.credentials.webhookSecretPrevious],
    nowMs: ctx.now(),
    toleranceSec,
  });
  if (!verdict.ok) return localRejection({ code: "SIGNATURE_INVALID", message: verdict.reason });
  const event = parseStripeEvent({ body: parseJson(rawBody) });
  if (event === undefined) return localRejection({ code: "INVALID_REQUEST", message: "signed body is not a Stripe Event" });
  // Belt and braces: test and live endpoints have different secrets, but a test event must never touch a live payment.
  if (event.livemode !== (ctx.account.mode === "live")) {
    return localRejection({ code: "INVALID_REQUEST", message: `event ${event.id} livemode=${String(event.livemode)} does not match account mode '${ctx.account.mode}'` });
  }
  return { kind: "ok", value: stripeEventFacts({ event }) };
}
