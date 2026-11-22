import type { HumanConfirmer, SurfaceExchangeStore, ToolExecutionContext, ToolExecutionOptions, ToolHandler } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { OriginRegistryPort } from "@jini-ai/core/contracts/server/verified-origin";
import type { Clock } from "@jini-ai/core/primitives";
import type { WebhookDeliveryRepoPort, WebhookSubscriptionRepoPort } from "../ports.js";
import type { WebhookSubscriptionRecord } from "../types.js";

/** The confirmation surface store the delete's held-open dialog is raised through. */
export interface WebhooksToolSurfaces {
  readonly surfaceExchanges: SurfaceExchangeStore;
}

/** What the delete's preparation step freezes for the human to confirm. */
export interface WebhooksDeletePrepared {
  subscriptionId: string;
  existing: WebhookSubscriptionRecord;
}

/**
 * The steps of the confirmation-gated delete, as the host's approval handler runs them. The host
 * owns the dialog (wording, transport, batching); the package owns what is prepared, what runs
 * after a confirm and what the model is told when the human did not confirm.
 */
export interface WebhooksDeleteSteps {
  surfaces: WebhooksToolSurfaces;
  prepare: (required: { ctx: ToolExecutionContext }, optional: ToolExecutionOptions) => Promise<WebhooksDeletePrepared>;
  run: (required: { ctx: ToolExecutionContext; prepared: WebhooksDeletePrepared; confirmer: HumanConfirmer; choice?: string }, optional: ToolExecutionOptions) => Promise<unknown>;
  declined: (required: { reason: "declined" | "expired" | "abandoned"; prepared?: WebhooksDeletePrepared }) => unknown;
}

/** The model-facing result of a confirmation the human declined, let expire or abandoned. */
export type WebhooksNotConfirmedResult = (outcome: { confirmed: false; reason: "declined" | "expired" | "abandoned" }) => {
  cancelled: boolean;
  reason?: "expired" | "abandoned";
  note: string;
};

/**
 * The deps the webhook tool handlers read, owned by the package side. The host's route deps
 * (`IntegrationsToolDeps`) satisfy it through the binding in `buildWebhooksRegistrations`: the
 * clock is converted to epoch milliseconds there and the confirmation machinery is passed in.
 */
export interface WebhooksPackageToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  clock: Clock;
  idGen: { newId(): string };
  webhookSubscriptionRepo: WebhookSubscriptionRepoPort;
  webhookDeliveryRepo: WebhookDeliveryRepoPort;
  originRegistry: OriginRegistryPort;
  // The transport raises ToolInputError for a missing channel: delegated tools must see the
  // missing capability, not an opaque SEC-005-redacted internal error that invites retries.
  confirmDelete: (steps: WebhooksDeleteSteps) => ToolHandler;
  notConfirmedResult: WebhooksNotConfirmedResult;
}
