/**
 * @file Integrations' half of the agent-tool wiring: maps `agent-tools.ts`'s 6 catalog entries onto
 * the list/create/update/pause/delete/deliveries operations the host's admin routes expose, as
 * `ToolRegistration`s. The owner's 2026-10-09 update authorization supersedes that catalog's historical update
 * exclusion; signing-secret rotation/generation/reveal remains excluded.
 *
 * Authorization shape: none of `createSubscription`/`pauseSubscription`/`deleteSubscription`
 * (`../subscriptions.ts`) accept an `authorize` dependency at all — `WebhookSubscriptionDeps` has no
 * such field, so the domain functions never gate themselves. Every admin route therefore calls
 * `authorize()` inline as its own first line (subscription mutations are a direct feature call, not
 * routed through a command gateway), and every handler (`tool-handlers.ts`) does the same via the
 * kit's `requireToolPermission`.
 *
 * The host binds its search vocabulary and approval policy afterwards with `withToolMetadata`.
 */
import {
  ToolPermissionDeniedError,
  buildDomainRegistrations,
  indexCatalogById,
  type AgentToolSideEffect,
  type ToolHandler,
  type ToolRegistration,
} from "@jini-ai/core";
import { forbiddenRule, withModelFacingErrors, type ModelFacingErrorRule } from "@jini-ai/core/model-facing-tool-errors";
import { versionConflictRule } from "@jini-ai/core/optimistic-concurrency";
import { WebhookSubscriptionNotFoundError, WebhookSubscriptionValidationError } from "../subscriptions.js";
import { getWebhooksAgentToolCatalog } from "./agent-tools.js";
import {
  webhooksCreateSubscriptionHandler,
  webhooksDeleteSubscriptionHandler,
  webhooksGetDeliveriesHandler,
  webhooksListSubscriptionsHandler,
  webhooksPauseSubscriptionHandler,
  webhooksUpdateSubscriptionHandler,
} from "./tool-handlers.js";
import type { WebhooksPackageToolDeps, WebhooksToolSurfaces } from "./tool-handlers.types.js";

const CATALOG_BY_ID = indexCatalogById({ catalog: getWebhooksAgentToolCatalog() });

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const webhooksDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> webhookSubscriptionRepo.listByWorkspace() + webhookDeliveryRepo.listBySubscription() (bounded,
  //    per subscription): reads only.
  ["webhooks_list_subscriptions", "none"],
  // -> webhookSubscriptionRepo.findById() + webhookDeliveryRepo.listBySubscription(): reads only.
  ["webhooks_get_deliveries", "none"],
  // -> createSubscription (subscriptions.ts): validates + repo.insert().
  ["webhooks_create_subscription", "mutates-durable-state"],
  // Existing updateSubscription validates replacement fields and the outbound origin before save.
  ["webhooks_update_subscription", "mutates-durable-state"],
  // -> pauseSubscription (subscriptions.ts): status flip + repo.save().
  ["webhooks_pause_subscription", "mutates-durable-state"],
  // -> deleteSubscription (subscriptions.ts): soft-delete status flip + repo.save(). Never
  //    row-deletes, but classified `deletes-durable-state` (not `mutates-durable-state`): no
  //    un-disable/reactivate path exists anywhere in this domain, so there is no agent-reachable
  //    undo — the same standard `content_post_delete` is classified under.
  ["webhooks_delete_subscription", "deletes-durable-state"],
]);

/**
 * The Integrations errors that reach the model with their real reason instead of a redacted
 * `INTERNAL_ERROR` — see `@jini-ai/core/model-facing-tool-errors` for the mechanism and for why
 * this list is an ALLOWLIST rather than a blanket unwrap.
 *
 * Reviewed against this domain's secret handling before listing anything, because Integrations is
 * the one domain in this sweep that holds credential material at all. Nothing on this list can
 * carry it: `WebhookSubscriptionValidationError` is raised only by `subscriptions.ts`'s own
 * label/topics/target_url checks (every construction site interpolates the CALLER's submitted
 * `targetUrl` or nothing at all), and `WebhookSubscriptionNotFoundError` interpolates the caller's
 * own id. The HMAC signing secret is never stored and never named by either class — it is derived
 * at delivery time by `KeyringPort.deriveSigningSecret` and lives entirely in `signing.ts`/
 * `keyring.env.ts`, whose errors (`SiteKeyFileAlreadyExistsError` among them) are deliberately
 * ABSENT here: they are operator/installation faults naming real filesystem paths, exactly the
 * class of internals this allowlist exists to keep redacted.
 *
 * `WebhookDeliveryVetoedError` (`delivery.ts`) is absent for a different reason — it is raised on
 * the OUTBOUND send path, which no tool in this catalog calls, so listing it would be speculative.
 */
const WEBHOOKS_MODEL_FACING_ERRORS: readonly ModelFacingErrorRule[] = [
  versionConflictRule({ readToolId: "content_read.webhook_subscription" }),
  forbiddenRule({ domainPrefix: "WEBHOOKS", error: ToolPermissionDeniedError }),
  { error: WebhookSubscriptionNotFoundError, code: "WEBHOOKS_SUBSCRIPTION_NOT_FOUND" },
  { error: WebhookSubscriptionValidationError, code: "WEBHOOKS_VALIDATION_FAILED" },
];

/**
 * The webhook tool registrations over the package-side deps: handlers, authored risk map and the
 * typed-error mapping. The host's search vocabulary and approval policy are bound afterwards by
 * `buildWebhooksRegistrations`.
 */
export function buildWebhooksToolRegistrations(
  { deps, surfaces }: { deps: WebhooksPackageToolDeps; surfaces: WebhooksToolSurfaces },
  _optional = {},
): ToolRegistration[] {
  const args = { deps, surfaces };
  const handlers: Record<string, ToolHandler> = {
    webhooks_list_subscriptions: webhooksListSubscriptionsHandler(args),
    webhooks_get_deliveries: webhooksGetDeliveriesHandler(args),
    webhooks_create_subscription: webhooksCreateSubscriptionHandler(args),
    webhooks_update_subscription: webhooksUpdateSubscriptionHandler(args),
    webhooks_pause_subscription: webhooksPauseSubscriptionHandler(args),
    webhooks_delete_subscription: webhooksDeleteSubscriptionHandler(args),
  };

  return buildDomainRegistrations({
    domain: "integrations",
    catalogModule: "webhooks/agent-tools.ts",
    catalog: CATALOG_BY_ID,
    // The whole map at once, so no handler can be the one that forgot — see
    // `withModelFacingErrors`' own doc for why a per-call-site reshape is the defect this avoids.
    handlers: withModelFacingErrors({ handlers, rules: WEBHOOKS_MODEL_FACING_ERRORS }),
    derivedRisk: webhooksDerivedRisk,
  });
}
