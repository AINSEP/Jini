/**
 * @file Webhook RECEIVE (lot L5): the framework-free core of `POST <prefix>/payments/webhooks/:siteId/:providerId/:endpointId`.
 * The express registrar (`src/http/payments-webhook.ts`) is a thin adapter over it.
 *
 * Who the event belongs to comes from the URL and the host's VERIFIED endpoint configuration
 * (`WebhookEndpointPort`), never from the payload: today's route took the workspace from the
 * webhook, so a webhook could land in a different workspace than the charge it named (gap check
 * item 1). The site is in the path so one provider account shared by two sites still routes each
 * endpoint to its own configuration.
 *
 * Receive only VERIFIES and RECORDS: each verified fact is written to the inbox (insert-or-ignore
 * on the provider event id) in one ledger transaction, and the provider gets its 2xx fast. Nothing
 * is applied in the request — the inbox worker (`worker.ts`) applies, retries and dead-letters.
 * A redelivery of an event whose row was dead-lettered REVIVES that row with the freshly verified
 * fact (counted as received): a later redelivery is how a provider-side or transient failure heals.
 * The raw body is never stored, only the verified fact and the body's sha256.
 */
import { createHash } from "node:crypto";
import type { PaymentProvider, ProviderContext } from "../contract/provider.js";
import { scopeProblem, type PaymentScope } from "../contract/scope.js";
import type { WebhookFact } from "../contract/evidence.js";
import type { PaymentsLedger } from "../ledger/repo.js";
import type { KernelProviderRegistry, ProviderContextPort } from "../provider-registry.js";

/** The three path segments of the webhook URL. */
export interface WebhookPath {
  readonly siteId: string;
  readonly providerId: string;
  readonly endpointId: string;
}

/**
 * Host-owned: the scope a configured webhook endpoint belongs to, from verified configuration (the
 * endpoint the host registered at the provider). `null` = no such endpoint.
 */
export interface WebhookEndpointPort {
  resolve(required: WebhookPath, optional?: { signal?: AbortSignal }): Promise<PaymentScope | null>;
}

export interface WebhookReceiverDeps {
  readonly ledger: PaymentsLedger;
  readonly providers: KernelProviderRegistry;
  readonly contexts: ProviderContextPort;
  readonly endpoints: WebhookEndpointPort;
  readonly now: () => number;
  readonly newId: () => string;
}

/** What the HTTP adapter sends back. `code` is machine-readable; `message` never carries provider text. */
export interface WebhookResponse {
  readonly status: 200 | 400 | 404 | 500 | 503;
  readonly body: { readonly received: number; readonly duplicates: number } | { readonly code: string; readonly message: string };
}

/** An endpoint the receiver accepts deliveries for: its verified scope and the provider that owns it. */
export interface ResolvedEndpoint {
  readonly scope: PaymentScope;
  readonly provider: PaymentProvider;
}

export type EndpointResolution =
  | { readonly ok: true; readonly endpoint: ResolvedEndpoint }
  | { readonly ok: false; readonly response: WebhookResponse };

export interface WebhookReceiver {
  /** Step 1, before any body is read: is this a configured endpoint of a loaded provider? */
  resolveEndpoint(required: { path: WebhookPath }, optional?: { signal?: AbortSignal }): Promise<EndpointResolution>;
  /** Step 2: verify the exact raw bytes and record every verified fact in the inbox. */
  receive(
    required: { endpoint: ResolvedEndpoint; rawBody: Uint8Array; headers: Readonly<Record<string, string>> },
    optional?: { signal?: AbortSignal }
  ): Promise<WebhookResponse>;
}

const fail = (status: WebhookResponse["status"], code: string, message: string): WebhookResponse => ({ status, body: { code, message } });

const NOT_FOUND = fail(404, "ENDPOINT_NOT_FOUND", "no such webhook endpoint");

/** A configured endpoint is only trusted when its scope is usable and names the same site and provider as the URL. */
function endpointMatches({ scope, path }: { scope: PaymentScope; path: WebhookPath }): boolean {
  return scopeProblem({ scope }) === null && scope.siteId === path.siteId && scope.providerId === path.providerId;
}

/** A provider plugin is third-party: a fact without its two ids cannot be deduped or located, so it is not recorded. */
function isRecordableFact(fact: WebhookFact): boolean {
  return typeof fact?.providerEventId === "string" && fact.providerEventId.length > 0 && typeof fact.providerRef === "string" && fact.providerRef.length > 0;
}

async function verify(
  deps: WebhookReceiverDeps,
  { endpoint, rawBody, headers, signal }: { endpoint: ResolvedEndpoint; rawBody: Uint8Array; headers: Readonly<Record<string, string>>; signal?: AbortSignal }
): Promise<{ ok: true; facts: readonly WebhookFact[] } | { ok: false; response: WebhookResponse }> {
  const resolved = await deps.contexts.resolve({ scope: endpoint.scope, provider: endpoint.provider }, signal ? { signal } : {});
  // Credentials can be configured later; 503 makes the provider redeliver instead of dropping the event.
  if (!resolved.ok) return { ok: false, response: fail(503, resolved.error.code, "payments provider is not configured for this endpoint") };
  const ctx: ProviderContext = resolved.ctx;
  const verified = await endpoint.provider.verifyWebhook({ rawBody, headers, ctx });
  if (verified.kind === "unknown") return { ok: false, response: fail(503, verified.error.code, "webhook could not be verified now; retry") };
  // A bad signature (or a payload the provider refuses) must not look like success: 4xx, never 2xx.
  if (verified.kind === "rejected") return { ok: false, response: fail(400, verified.error.code, "webhook rejected") };
  return { ok: true, facts: verified.value };
}

/**
 * Builds the receiver.
 * @complexity O(facts) per delivery; one ledger transaction.
 */
export function createWebhookReceiver(deps: WebhookReceiverDeps, _optional: Record<string, never> = {}): WebhookReceiver {
  return {
    resolveEndpoint: async ({ path }, optional = {}) => {
      const scope = await deps.endpoints.resolve(path, optional.signal ? { signal: optional.signal } : {});
      if (!scope || !endpointMatches({ scope, path })) return { ok: false, response: NOT_FOUND };
      const registered = deps.providers.get({ id: path.providerId });
      // Configured but its plugin is not loaded (disabled, failed to activate): the provider should redeliver later.
      if (!registered) return { ok: false, response: fail(503, "PROVIDER_NOT_REGISTERED", "payments provider is not loaded") };
      return { ok: true, endpoint: { scope, provider: registered.provider } };
    },
    receive: async ({ endpoint, rawBody, headers }, optional = {}) => {
      const verified = await verify(deps, { endpoint, rawBody, headers, ...(optional.signal ? { signal: optional.signal } : {}) });
      if (!verified.ok) return verified.response;
      if (!verified.facts.every(isRecordableFact)) return fail(500, "INVALID_FACT", "payments provider returned an unusable webhook fact");
      const bodySha256 = createHash("sha256").update(rawBody).digest("hex");
      const { scope } = endpoint;
      const inserted = await deps.ledger.transaction(async (tx) => {
        const results: boolean[] = [];
        for (const fact of verified.facts) {
          const now = deps.now();
          const factsJson = JSON.stringify(fact);
          const row = await tx.insertInbox({
            entry: {
              id: deps.newId(), workspaceId: scope.workspaceId, siteId: scope.siteId, providerId: scope.providerId,
              providerAccountId: scope.providerAccountId, mode: scope.mode, providerEventId: fact.providerEventId,
              factsJson, bodySha256, nextAttemptAt: now, receivedAt: now,
            },
          });
          // A duplicate of a dead letter reopens it; of an open or applied row, it is a plain duplicate (false).
          results.push(row.inserted || (await tx.reviveInbox({ id: row.id, nextAttemptAt: now }, { payload: { factsJson, bodySha256 } })));
        }
        return results;
      });
      const received = inserted.filter(Boolean).length;
      return { status: 200, body: { received, duplicates: inserted.length - received } };
    },
  };
}
