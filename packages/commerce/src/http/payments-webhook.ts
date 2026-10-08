import express, { type Express, type Request } from "express";

import type { LipayApi } from "../payments/lipay-plugin.js";
import type { PaymentError } from "../payments/ports.js";

/**
 * @file The one core-owned payment webhook route: `POST /payments/webhook/:providerId`.
 *
 * Public and unauthenticated by necessity — a payment provider has no host session. Authentication
 * IS the provider's signature verification, performed inside `parseWebhook`. This is the deliberate
 * inverse of WooCommerce's `do_action('woocommerce_api_' . $api_request)`, where the hook suffix is
 * a lowercased class name, two plugins can trivially collide on it, and there is no verification,
 * no routing table and no delivery log. Here `:providerId` is a registry lookup and a miss is a
 * typed `PROVIDER_NOT_REGISTERED`.
 *
 * THE RAW-BODY FIX (the reason this file is registered where it is). `app.ts` mounts one blanket
 * `express.json({ limit: "15mb" })` ahead of all route registration; by the time an ordinary
 * handler runs, `req.body` is a parsed object and the original bytes are gone. HMAC signatures are
 * computed over exact bytes, and a parse-then-reserialize round trip changes key order and
 * whitespace, so verification would fail for every provider.
 *
 * The fix is registration ORDER, not a second parser. Express matches layers in the order they were
 * added, so this route — registered before the blanket `express.json` layer — runs its own
 * `express.raw({ type: "application/json", limit: "1mb" })` and then terminates the response, and
 * the blanket JSON parser is never reached for this one path. Everything else in the app is
 * untouched.
 *
 * The rejected alternative was stashing a buffer from `express.json`'s `verify` hook: that pays the
 * cost on every request in the process, and `middleware/body-size-limit.ts`'s header already
 * documents that `body-parser` marks a parsed request so a later `express.json()` silently no-ops —
 * an interaction worth not depending on.
 *
 * Registering early has one structural consequence in this codebase's boot sequence: `createApp()`
 * is synchronous, while lipay is a Tier-2 plugin activated asynchronously against a real SQLite
 * handle (`bootstrapLipay`), and the hermetic in-memory composition has no lipay at all. So the API
 * is resolved through a callback at REQUEST time rather than captured at registration time — that
 * is what decouples "must be registered before line 444" from "cannot be activated that early".
 */
export interface PaymentsWebhookDeps {
  /** Resolved per request — see the file header on why this cannot be a captured value. */
  resolveLipay: () => LipayApi | null;
}

/** Providers are HTTP clients, not browsers: a repeated header is joined, never silently dropped. */
function flattenHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

/**
 * A verification or routing failure must NOT look like success — a 2xx would make the provider stop
 * retrying a delivery that was never processed. The 2xx-always instinct applies only to events core
 * accepted but had no handler for, which `handleWebhook` already reports as `accepted: true`.
 */
function statusForError(error: PaymentError | undefined): number {
  switch (error?.code) {
    case "PROVIDER_NOT_REGISTERED":
      return 404;
    case "SIGNATURE_INVALID":
      return 401;
    case "NO_CREDENTIALS_CONFIGURED":
      return 503;
    default:
      return 400;
  }
}

export function registerPaymentsWebhookRoute({ app, deps }: { app: Express; deps: PaymentsWebhookDeps }, _optional: Record<string, never> = {}): void {
  app.post(
    "/payments/webhook/:providerId",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req, res) => {
      try {
        const lipay = deps.resolveLipay();
        if (!lipay) {
          res.status(503).json({ error: "payments are not configured on this install", code: "PAYMENTS_UNAVAILABLE" });
          return;
        }

        // `express.raw` leaves `req.body` untouched when the content type does not match; an empty
        // buffer then fails signature verification, which is the correct outcome for a delivery that
        // did not arrive as JSON.
        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

        const ack = await lipay.handleWebhook({
          providerId: req.params.providerId ?? "",
          rawBody,
          headers: flattenHeaders(req),
        });

        if (!ack.accepted) {
          res.status(statusForError(ack.error)).json({ error: ack.error?.message, code: ack.error?.code });
          return;
        }
        res.status(200).json({ processed: ack.processed, duplicates: ack.duplicates });
      } catch (err) {
        // A provider that never gets a response just retries the same delivery forever (this file's
        // own header: a missing/failed response must never look like undelivered-but-silently-lost).
        // 500 tells the provider to retry, which is the correct instruction for a failure on THIS
        // side (unlike `statusForError`'s codes, which describe a judgment already reached about the
        // delivery itself).
        // Provider exceptions may contain credentials; send the fixed error without logging them.
        res.status(500).json({ error: "internal error", code: "INTERNAL_ERROR" });
      }
    }
  );
}
