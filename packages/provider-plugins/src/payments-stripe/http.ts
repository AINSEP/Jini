import { paymentError, type Outcome, type PaymentErrorCode, type ProviderContext } from "@jini-ai/commerce/payments/kernel";

const STATUS_CODES: Readonly<Record<number, PaymentErrorCode>> = {
  400: "INVALID_REQUEST", 401: "NO_CREDENTIALS_CONFIGURED", 402: "DECLINED",
  403: "NO_CREDENTIALS_CONFIGURED", 404: "INVALID_REQUEST", 429: "PROVIDER_ERROR",
};

/** Narrows parsed JSON objects without treating arrays or null as records. O(1) time/space. */
function record({ value }: { value: unknown }, _optional: Record<string, never> = {}): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Selects a proven rejection code, or null when money may have moved. O(1) time/space. */
function rejectionCode({ status, type }: { status: number; type: unknown }, _optional: Record<string, never> = {}): PaymentErrorCode | null {
  // Server failures and in-flight idempotency keys never prove that no money moved.
  if (status >= 500 || status === 409) return null;
  if ([401, 403, 429].includes(status)) return STATUS_CODES[status]!;
  if (status === 400 && type === "idempotency_error") return "IDEMPOTENCY_CONFLICT";
  if (type === "card_error") return "DECLINED";
  return STATUS_CODES[status] ?? null;
}

/** Classifies a response without exposing provider messages or throwing. O(1) time/space. */
export function stripeOutcome({ status, json }: { status: number; json: unknown }, _optional: Record<string, never> = {}): Outcome<Readonly<Record<string, unknown>>> {
  const value = record({ value: json });
  if (status >= 200 && status < 300 && value !== null) return { kind: "ok", value };
  const code = rejectionCode({ status, type: record({ value: value?.error })?.type });
  return { kind: code === null ? "unknown" : "rejected", error: paymentError(
    { code: code ?? "PROVIDER_ERROR", message: "payment provider request did not confirm success" },
    { retryable: code === null || status === 429, providerStatus: status }
  ) };
}

/** Sends once through the host's guarded HTTP port; transport/parse ambiguity stays unresolved.
 * No response or exception text escapes into payment errors. Deadlines bound the single call.
 * @complexity O(n) time/space in encoded form and bounded response size; one HTTP call. */
export async function stripeRequest(
  { ctx, method, path }: { ctx: ProviderContext; method: "GET" | "POST"; path: string },
  optional: { form?: ReadonlyArray<readonly [string, string]>; idempotencyKey?: string } = {}
): Promise<Outcome<Readonly<Record<string, unknown>>>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${ctx.credentials.secretKey}` };
  if (optional.idempotencyKey !== undefined) headers["Idempotency-Key"] = optional.idempotencyKey;
  const body = optional.form === undefined ? undefined : new URLSearchParams(optional.form.map(([key, value]) => [key, value])).toString();
  if (body !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
  try {
    const response = await ctx.httpClient.send({ request: {
      method, url: `https://api.stripe.com${path}`, headers, timeoutMs: 30_000, totalDeadlineMs: 30_000,
      ...(body === undefined ? {} : { body }),
    } });
    let json: unknown;
    try { json = JSON.parse(response.bodyText); } catch { json = null; }
    return stripeOutcome({ status: response.status, json });
  } catch {
    return { kind: "unknown", error: paymentError(
      { code: "TRANSPORT_ERROR", message: "payment provider request could not be confirmed" }, { retryable: true }
    ) };
  }
}
