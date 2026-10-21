/**
 * @file The one place a Stripe request is built and its response classified. Every call goes
 * through the host's `ctx.httpClient` (the ADR-038 egress seam): there is no `stripe` npm SDK and
 * no `fetch` here, so the host's egress guard, timeouts and recording see every byte.
 *
 * Wire format (https://docs.stripe.com/api, verified by the deprecated capability-providers port):
 * HTTP Basic auth with the secret key as the username and an empty password; request bodies are
 * `application/x-www-form-urlencoded` with bracketed keys (`metadata[jini_payment_id]`); every
 * mutation carries `Idempotency-Key`, so a retry with the kernel's stable key can never charge twice.
 */
import type { HttpRequest } from "@jini-ai/core/primitives";
import type { Outcome, ProviderContext } from "@jini-ai/commerce/payments/kernel";
import {
  classifyStripeFailure,
  localRejection,
  transportFailure,
  unparseableSuccess,
  type StripeErrorFields,
} from "./errors.js";
import { isRecord, optionalString, type JsonObject } from "./json.js";

/** Settings fixed when the provider is created. */
export interface StripeTransportConfig {
  /** No trailing slash, e.g. `https://api.stripe.com`. */
  readonly apiBase: string;
  /** Sent as `Stripe-Version`, so response shapes do not drift with the account's default version. */
  readonly apiVersion: string;
  /** Socket idle budget per request. */
  readonly timeoutMs: number;
}

/** One Stripe API call. `form` entries keep their order on the wire. */
export interface StripeCall {
  readonly method: "GET" | "POST";
  /** Path under the API base, starting `/v1/`. */
  readonly path: string;
  readonly query?: ReadonlyArray<readonly [string, string]>;
  readonly form?: ReadonlyArray<readonly [string, string]>;
  readonly idempotencyKey?: string;
}

const encode = (entries: ReadonlyArray<readonly [string, string]>): string =>
  new URLSearchParams(entries.map(([key, value]): [string, string] => [key, value])).toString();

function basicAuth(secretKey: string): string {
  const credentials = Buffer.from(secretKey + ":", "utf8").toString("base64");
  return `Basic ${credentials}`;
}

/**
 * The exact `HttpRequest` for a call. POSTs always send a form body (possibly empty) so the
 * content type is stable; GETs never do.
 * @complexity O(n) in the number of parameters.
 */
export function buildStripeRequest(
  { call, secretKey, config }: { call: StripeCall; secretKey: string; config: StripeTransportConfig },
  optional: { signal?: AbortSignal } = {}
): HttpRequest {
  const query = call.query && call.query.length > 0 ? "?" + encode(call.query) : "";
  const headers: Record<string, string> = { Authorization: basicAuth(secretKey), "Stripe-Version": config.apiVersion };
  if (call.idempotencyKey !== undefined) headers["Idempotency-Key"] = call.idempotencyKey;
  const isPost = call.method === "POST";
  if (isPost) headers["Content-Type"] = "application/x-www-form-urlencoded";
  return {
    method: call.method,
    url: `${config.apiBase}${call.path}${query}`,
    headers,
    ...(isPost ? { body: encode(call.form ?? []) } : {}),
    idleTimeoutMs: config.timeoutMs,
    ...(optional.signal === undefined ? {} : { signal: optional.signal }),
  };
}

function parseBody(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return undefined;
  }
}

function errorFields(body: unknown): StripeErrorFields {
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  const type = optionalString(error.type);
  const code = optionalString(error.code);
  const message = optionalString(error.message);
  return { ...(type === undefined ? {} : { type }), ...(code === undefined ? {} : { code }), ...(message === undefined ? {} : { message }) };
}

/**
 * Send one call and classify the answer: a 2xx JSON object is `ok`; everything else goes through
 * the outcome table in `errors.ts`. Never throws.
 * @param required.what - Object name for the "unparseable 2xx" message (`PaymentIntent`, `list`).
 * @complexity O(1) plus the response size.
 */
export async function callStripe(
  { call, ctx, config }: { call: StripeCall; ctx: ProviderContext; config: StripeTransportConfig },
  optional: { signal?: AbortSignal } = {}
): Promise<Outcome<JsonObject>> {
  const secretKey = ctx.credentials.secretKey ?? "";
  if (secretKey.length === 0) return localRejection({ code: "NO_CREDENTIALS_CONFIGURED", message: "credential slot 'secretKey' is empty" });
  const request = buildStripeRequest({ call, secretKey, config }, optional);
  let response;
  try {
    response = await ctx.httpClient.send({ request });
  } catch (cause) {
    return transportFailure({ cause });
  }
  const body = parseBody(response.bodyText);
  if (response.status < 200 || response.status > 299) return classifyStripeFailure({ status: response.status, error: errorFields(body) });
  return isRecord(body) ? { kind: "ok", value: body } : unparseableSuccess({ status: response.status, what: "JSON object" });
}
