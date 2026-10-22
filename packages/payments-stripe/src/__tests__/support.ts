/**
 * Test doubles: a scripted `HttpClientPort` that records every request and answers from a queue,
 * and a `ProviderContext` builder. No network, no Stripe SDK.
 */
import type { HttpClientPort, HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import type { ProviderContext } from "@jini-ai/commerce/payments/kernel";

export type Scripted = { readonly status: number; readonly body: unknown } | { readonly status: number; readonly text: string } | { readonly throws: unknown };

export interface FakeHttp extends HttpClientPort {
  readonly requests: HttpRequest[];
  enqueue(...answers: Scripted[]): void;
}

/** Answers in order; an unscripted call fails the test loudly instead of inventing a response. */
export function fakeHttp(...initial: Scripted[]): FakeHttp {
  const queue = [...initial];
  const requests: HttpRequest[] = [];
  return {
    requests,
    enqueue: (...answers) => queue.push(...answers),
    send: async ({ request }): Promise<HttpResponse> => {
      requests.push(request);
      const next = queue.shift();
      if (next === undefined) throw new Error(`unscripted request ${request.method} ${request.url}`);
      if ("throws" in next) throw next.throws;
      return { status: next.status, headers: {}, bodyText: "text" in next ? next.text : JSON.stringify(next.body) };
    },
  };
}

export const SECRET_KEY = "sk_test_fake_0000";
export const WEBHOOK_SECRET = "whsec_test_current";
export const WEBHOOK_SECRET_PREVIOUS = "whsec_test_previous";
/** 2023-06-06T22:19:30Z — the fixtures' event `created`. */
export const NOW_MS = 1686089970_000;

export const AUTH = `Basic ${Buffer.from(`${SECRET_KEY}:`).toString("base64")}`;

export function makeContext(
  http: HttpClientPort,
  overrides: { credentials?: Record<string, string>; mode?: "test" | "live"; now?: number; returnUrl?: string } = {}
): ProviderContext {
  return {
    credentials: overrides.credentials ?? { secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET },
    account: { providerAccountId: "acct_1Test", mode: overrides.mode ?? "test" },
    httpClient: http,
    now: () => overrides.now ?? NOW_MS,
    webhookUrl: "https://shop.example/api/payments/webhooks/site_1/stripe/acct_1Test",
    returnUrl: overrides.returnUrl ?? "https://shop.example/checkout/return",
  };
}

export const form = (request: HttpRequest | undefined): [string, string][] => [...new URLSearchParams(String(request?.body ?? "")).entries()];
