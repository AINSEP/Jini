/** Host callback and actor-attribution adapter; Jini owns subscription validation and lifecycle.
 *
 * Contract rationale for the Jini implementation and this host boundary:
 *
 * @file Webhook subscription CRUD (ADR-036 §2/§6) — the write-service behind the admin/AI
 * gateway handlers.
 *
 * Purpose:
 * `createSubscription` / `updateSubscription` / `pauseSubscription` / `deleteSubscription`.
 * Mirrors `src/features/post/post.ts`'s `updatePost` shape (required `{ deps, input }` +
 * optional second param), since these functions play the same "feature write-service" role.
 *
 * How it relates to the project:
 * - Every mutation here is the thing the ADR-036 §6 gateway/`authorize()` chokepoint calls —
 *   this file itself does no authorization; that lives in the (out-of-scope) route handler.
 * - `target_url` validation reuses `EgressPolicy`'s intent (only `https://`, only allowed
 *   hosts) but does NOT import `src/origin` directly — that module may not exist yet or be
 *   mid-build by another agent. Callers inject `isAllowedTarget`; production wiring plugs in
 *   the real SSRF/egress check once that module lands (see `WebhookSubscriptionDeps` doc).
 * - `deleteSubscription` never row-deletes (ADR-036 §2 / `WebhookSubscriptionRecord.disabledAt`
 *   doc: "Set (never row-deleted) when disabled, for audit durability") — it soft-disables via
 *   `repo.save`, matching that `WebhookSubscriptionRepoPort` has no `delete` method at all.
 *
 * Architectural role:
 * Jini owns the feature-level business rules. Repositories stay behind `WebhookSubscriptionRepoPort`; Express
 * routes and admin/AI tool surfaces call these functions, never the repo directly.
 *
 * Egress allowlist check for a candidate `target_url` (beyond the flat `https://` scheme
 * requirement enforced here). Injected rather than importing `Jini packages/http-kit/src/verified-origin/origin.ts` directly — see the
 * file header. Production wiring: `core/origin`'s `isAllowedEgressTarget` (ADR-040).
 *
 * Create a new webhook subscription. Starts `active` with `secretVersion: 1` and no rotation in
 * progress (`previousSecretVersion: null`) — the signing secret itself is derived at delivery
 * time (ADR-036 §5), never generated or stored here.
 *
 * @complexity O(topics) for de-duplication; one repo write.
 * @overallScore 100
 *
 * Update a subscription's label/target/topics. Does not touch `status` or secret versioning —
 * those are `pauseSubscription`'s and (deferred) rotation's job respectively.
 *
 * @complexity O(topics); one repo read + one repo write.
 * @overallScore 100
 *
 * `true` (default) pauses; `false` resumes back to `active`. One function, both directions —
 * matches the CRUD list this library owes (no separate `resumeSubscription` was asked for).
 *
 * Pause or resume an active/paused subscription. A `disabled` (soft-deleted) subscription is a
 * terminal state — it cannot be paused or resumed back to life; delete-then-recreate instead.
 *
 * @complexity O(1); one repo read + one repo write.
 * @overallScore 100
 *
 * Soft-delete: sets `status: "disabled"` + stamps `disabledAt`. Never row-deletes (audit
 * durability, ADR-036 §2) — `WebhookSubscriptionRepoPort` has no `delete` method for exactly
 * this reason.
 *
 * @complexity O(1); one repo read + one repo write.
 * @overallScore 100
 *
 * Enforce `https://` (ADR-036 §4 SSRF/egress posture starts here) and defer to the injected
 * allowlist check. Returns the trimmed URL so callers store a normalized value.
 *
 * Trim, drop blanks, and de-duplicate topics while preserving first-seen order.
 */
import {
  createSubscription as createWebhookSubscription,
  updateSubscription as updateWebhookSubscription,
  pauseSubscription as pauseWebhookSubscription,
  deleteSubscription as deleteWebhookSubscription,
  type WebhookSubscriptionDeps as JiniSubscriptionDeps,
  type CreateSubscriptionInput as JiniCreateInput,
  type UpdateSubscriptionInput,
  type PauseSubscriptionInput,
  type PauseSubscriptionOptional,
  type DeleteSubscriptionInput,
  type WebhookSubscriptionOptional,
} from "../index.js";

export { WebhookSubscriptionNotFoundError, WebhookSubscriptionValidationError } from "../index.js";
export type { UpdateSubscriptionInput, PauseSubscriptionInput, PauseSubscriptionOptional, DeleteSubscriptionInput, WebhookSubscriptionOptional } from "../index.js";

export interface WebhookSubscriptionDeps extends Omit<JiniSubscriptionDeps, "isAllowedTarget" | "clock"> {
  clock: { nowIso(): string };
  isAllowedTarget: (required: { url: string }, optional?: Record<string, never>) => Promise<boolean>;
}
export interface CreateSubscriptionInput extends JiniCreateInput { createdByPluginId?: string | null; }
export interface CreateSubscriptionRequired { deps: WebhookSubscriptionDeps; input: CreateSubscriptionInput; }
export interface UpdateSubscriptionRequired { deps: WebhookSubscriptionDeps; input: UpdateSubscriptionInput; }
export interface PauseSubscriptionRequired { deps: WebhookSubscriptionDeps; input: PauseSubscriptionInput; }
export interface DeleteSubscriptionRequired { deps: WebhookSubscriptionDeps; input: DeleteSubscriptionInput; }

/** Adapts the ISO clock contract to Jini's `nowMs` clock. */
function adaptSubscriptionDeps(deps: WebhookSubscriptionDeps): JiniSubscriptionDeps {
  return {
    ...deps,
    // Existing routes and excluded durable adapters keep their ISO clock contract.
    clock: { nowMs: () => Date.parse(deps.clock.nowIso()) },
  };
}

/** Keep existing actor attribution while moving it into Jini's optional object.
 * @complexity O(topics), with one guarded target check and one repo write.
 */
export function createSubscription({ deps, input }: CreateSubscriptionRequired, optional: WebhookSubscriptionOptional = {}) {
  const { createdByPluginId, ...requiredInput } = input;
  return createWebhookSubscription({ deps: adaptSubscriptionDeps(deps), input: requiredInput }, {
    ...(createdByPluginId !== undefined ? { createdByPluginId } : {}), ...optional,
  });
}

/** Translate the target-policy callback; validation completes before the replacement is saved. */
export function updateSubscription({ deps, input }: UpdateSubscriptionRequired, optional: WebhookSubscriptionOptional & { expectedVersion?: number } = {}) {
  return updateWebhookSubscription({ deps: adaptSubscriptionDeps(deps), input }, optional);
}

/** Translate the host callback without changing the paused/disabled lifecycle. */
export function pauseSubscription({ deps, input }: PauseSubscriptionRequired, optional: PauseSubscriptionOptional = {}) {
  return pauseWebhookSubscription({ deps: adaptSubscriptionDeps(deps), input }, optional);
}

/** Translate the host callback while retaining soft-delete audit history. */
export function deleteSubscription({ deps, input }: DeleteSubscriptionRequired, optional: WebhookSubscriptionOptional & { expectedVersion?: number } = {}) {
  return deleteWebhookSubscription({ deps: adaptSubscriptionDeps(deps), input }, optional);
}
// Lifecycle/egress rationale: ../subscriptions.ts (ADR-036).
