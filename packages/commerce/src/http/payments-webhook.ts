import express, { type IRouter, type NextFunction, type Request, type Response } from "express";

import type { ResolvedEndpoint, WebhookPath, WebhookReceiver, WebhookResponse } from "../payments/ingest/receive.js";

/**
 * @file The one core-owned payment webhook route: `POST <prefix>/payments/webhooks/:siteId/:providerId/:endpointId`,
 * a thin express adapter over the payments kernel's receiver (`payments/ingest/receive.ts`), which
 * verifies and records; the inbox worker applies.
 *
 * Public and unauthenticated by necessity — a payment provider has no host session. Authentication
 * IS the provider's signature verification. This is the deliberate inverse of WooCommerce's
 * `do_action('woocommerce_api_' . $api_request)`, where the hook suffix is a lowercased class name,
 * two plugins can trivially collide on it, and there is no verification, no routing table and no
 * delivery log. Here the path is a lookup in the host's verified endpoint configuration and the
 * provider registry, and a miss is a 404 — answered before the body is read.
 *
 * Who the event belongs to (workspace, provider account, mode) comes ONLY from that endpoint
 * configuration, never from the payload: the previous route took the workspace from the webhook.
 *
 * THE RAW-BODY FIX (the reason this route must be registered where it is). A host typically mounts
 * one blanket `express.json(...)` ahead of its routes; by the time an ordinary handler runs,
 * `req.body` is a parsed object and the original bytes are gone. HMAC signatures are computed over
 * exact bytes, and a parse-then-reserialize round trip changes key order and whitespace, so
 * verification would fail for every provider.
 *
 * The fix is registration ORDER, not a second parser. Express matches layers in the order they were
 * added, so this route — registered before the blanket JSON layer — runs its own `express.raw` and
 * then terminates the response, and the blanket parser is never reached for this one path.
 *
 * The rejected alternative was stashing a buffer from `express.json`'s `verify` hook: that pays the
 * cost on every request in the process, and `body-parser` marks a parsed request so a later
 * `express.json()` silently no-ops — an interaction worth not depending on.
 *
 * The receiver is resolved through a callback at REQUEST time rather than captured at
 * registration: route registration is synchronous and early, while the payments kernel (its ledger
 * and provider plugins) is activated asynchronously later — that decouples "must be registered
 * before the blanket parser" from "cannot be activated that early".
 */
export interface PaymentsWebhookDeps {
  /** Resolved per request — see the file header on why this cannot be a captured value. `null` = payments not configured. */
  resolveReceiver: () => WebhookReceiver | null;
}

/**
 * Providers are HTTP clients, not browsers: a repeated header is joined, never silently dropped.
 * Read from `rawHeaders` (every line as sent, always strings) rather than `req.headers`, where
 * Node keeps only the first of some duplicated headers.
 */
function flattenHeaders(req: Request): Record<string, string> {
  const headers = new Map<string, string>();
  const raw = req.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = (raw[i] as string).toLowerCase();
    const value = raw[i + 1] as string;
    const seen = headers.get(name);
    headers.set(name, seen === undefined ? value : `${seen}, ${value}`);
  }
  return Object.fromEntries(headers);
}

const send = (res: Response, response: WebhookResponse): void => {
  res.status(response.status).json(response.body);
};

/**
 * A failure on THIS side (ledger down, a throwing port) must not look like success — a 2xx would
 * make the provider stop retrying a delivery that was never recorded. 500 tells it to retry.
 * Port and provider exceptions may contain credentials; send the fixed error without logging them.
 */
const internalError = (res: Response): void => {
  res.status(500).json({ code: "INTERNAL_ERROR", message: "internal error" });
};

interface Locals {
  receiver: WebhookReceiver;
  endpoint: ResolvedEndpoint;
}

/** Step 1: a 404/503 is answered before `express.raw` reads a single byte of the body. */
function resolveStep(deps: PaymentsWebhookDeps) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const receiver = deps.resolveReceiver();
      if (!receiver) {
        res.status(503).json({ code: "PAYMENTS_UNAVAILABLE", message: "payments are not configured on this install" });
        return;
      }
      // The route path declares all three segments, so express always sets them.
      const { siteId, providerId, endpointId } = req.params as unknown as WebhookPath;
      const resolved = await receiver.resolveEndpoint({ path: { siteId, providerId, endpointId } });
      if (!resolved.ok) {
        send(res, resolved.response);
        return;
      }
      res.locals.payments = { receiver, endpoint: resolved.endpoint } satisfies Locals;
      next();
    } catch {
      internalError(res);
    }
  };
}

/** Step 3: verify + record. */
async function receiveStep(req: Request, res: Response): Promise<void> {
  try {
    const { receiver, endpoint } = res.locals.payments as Locals;
    // `express.raw` here accepts every content type, but a request WITHOUT a body is skipped and
    // leaves `req.body` as body-parser's `{}` (so does a host parser mounted ahead of this route by
    // mistake). Empty bytes then fail signature verification: the correct 4xx.
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const response = await receiver.receive({ endpoint, rawBody, headers: flattenHeaders(req) });
    send(res, response);
  } catch {
    internalError(res);
  }
}

/**
 * Register the webhook route. Must run BEFORE the host's blanket body parser (file header).
 * @param optional.prefix - Mount prefix, e.g. `/api` → `/api/payments/webhooks/...`. Default none.
 * @param optional.limit - Max body size (`express.raw` syntax). Default `1mb`.
 */
export function registerPaymentsWebhookRoute(
  { app, deps }: { app: IRouter; deps: PaymentsWebhookDeps },
  optional: { prefix?: string; limit?: string } = {}
): void {
  app.post(
    `${optional.prefix ?? ""}/payments/webhooks/:siteId/:providerId/:endpointId`,
    resolveStep(deps),
    // Every content type: a provider signs the bytes it sent, whatever it labels them.
    express.raw({ type: () => true, limit: optional.limit ?? "1mb" }),
    receiveStep
  );
}
