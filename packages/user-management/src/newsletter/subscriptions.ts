/**
 * @file `subscriptions.ts` — subscription add/import chokepoint (ADR-PIPE-011 C-013, REQ-10/31).
 *
 * `importSubscriptions` MUST call the exact same per-row path `saveSubscription` uses — any
 * divergence breaks REQ-31's "no separate unvalidated import path" guarantee (aggregate-risk note,
 * ADR-PIPE-011 Contract Map). Never creates a new Members identity (REQ-10) — resolves via
 * `SubscriberDirectoryPort`, read-only.
 */
import type { UUID } from "@jini-ai/core/primitives";
import { issueConfirmationToken, type ConfirmationDeps } from "./confirmation.js";
import {
  NewsletterListNotFoundError,
  NewsletterSubscriberNotFoundError,
  NewsletterSubscriptionNotFoundError,
  NewsletterValidationError,
} from "./errors.js";
import type {
  MembersConsentCapability,
  NewsletterListRepoPort,
  NewsletterSubscriptionRepoPort,
  SubscriberDirectoryPort,
} from "./ports.js";
import type { SubscriptionRow } from "./types.js";

const IMPORT_BATCH_MAX = 500;

export interface SubscriptionsDeps {
  subscriptionRepo: NewsletterSubscriptionRepoPort;
  /** api.spec.md §6: `CREATE_SUBSCRIPTION`/`IMPORT_SUBSCRIPTIONS` -> `404 NEWSLETTER_LIST_NOT_FOUND` for an unknown `listId`. */
  listRepo: NewsletterListRepoPort;
  subscriberDirectory: SubscriberDirectoryPort;
  confirmationDeps: ConfirmationDeps;
  clock: { nowIso(): string };
  ids: { newId(): string };
}

async function requireActiveList(
  { listRepo, workspaceId, listId }: { listRepo: NewsletterListRepoPort; workspaceId: UUID; listId: UUID },
  _optional = {},
): Promise<void> {
  const list = await listRepo.findById({ workspaceId, id: listId });
  if (!list) {
    throw new NewsletterListNotFoundError(`list ${listId} was not found`);
  }
  if (list.status === "archived") {
    throw new NewsletterValidationError({ field: "listId", reason: "archived", message: "This list is archived." });
  }
}

/** C-013 — resolve `subscriberId` via `SubscriberDirectoryPort`, create a `pending` subscription, trigger confirmation (AC-12/13). */
export async function saveSubscription(required: {
  deps: SubscriptionsDeps;
  input: { workspaceId: UUID; listId: UUID; subscriberId: UUID; source: SubscriptionRow["source"] };
}, _optional: Record<string, never> = {}): Promise<{ subscription: SubscriptionRow }> {
  const { deps, input } = required;

  await requireActiveList({ listRepo: deps.listRepo, workspaceId: input.workspaceId, listId: input.listId });

  const contact = await deps.subscriberDirectory.getContact({ workspaceId: input.workspaceId, subscriberId: input.subscriberId });
  if (!contact) {
    throw new NewsletterSubscriberNotFoundError({ message: `subscriber ${input.subscriberId} was not found`, subscriberId: input.subscriberId });
  }

  const existing = await deps.subscriptionRepo.findBySubscriberAndList({
    workspaceId: input.workspaceId,
    listId: input.listId,
    subscriberId: input.subscriberId,
  });
  const now = deps.clock.nowIso();
  const subscription: SubscriptionRow = existing ?? {
    id: deps.ids.newId(),
    workspaceId: input.workspaceId,
    listId: input.listId,
    subscriberId: input.subscriberId,
    status: "pending",
    source: input.source,
    consentRevisionIdAtSubscribe: null,
    subscribedAt: null,
    unsubscribedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await deps.subscriptionRepo.save(subscription);

  await issueConfirmationToken({
    deps: deps.confirmationDeps,
    input: { workspaceId: input.workspaceId, subscriptionId: subscription.id, recipientEmail: contact.email },
  });

  return { subscription };
}

export interface UnsubscribeSubscriptionDeps {
  subscriptionRepo: NewsletterSubscriptionRepoPort;
  /** `null` = unbound — see `launch-gate.ts`'s file header on why this must never be stubbed to succeed. */
  consentCapability: MembersConsentCapability | null;
  clock: { nowIso(): string };
}

/**
 * C-013 (admin-triggered removal half) — `REMOVE_SUBSCRIPTION` (api.spec.md §1/§5): flips a
 * subscription to `unsubscribed` directly, by primary key, no signed token involved (unlike
 * `unsubscribe.ts`'s `processUnsubscribe`, which verifies a `KeyringPort`-derived token and is the
 * self-service, no-login public path). Same terminal shape and the same conditional
 * `MembersConsentCapability.revoke()` side effect `processUnsubscribe` performs — an admin removing
 * a subscription must revoke real consent state exactly as a self-service unsubscribe would, once a
 * real binding exists. Idempotent: removing an already-`unsubscribed` subscription is a no-op
 * success, not an error (mirrors `processUnsubscribe`'s EC-03 carve-out).
 */
export async function unsubscribeSubscription(required: {
  deps: UnsubscribeSubscriptionDeps;
  input: { workspaceId: UUID; id: UUID };
}, _optional: Record<string, never> = {}): Promise<{ subscription: SubscriptionRow }> {
  const { deps, input } = required;
  const existing = await deps.subscriptionRepo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!existing) {
    throw new NewsletterSubscriptionNotFoundError(`subscription ${input.id} was not found`);
  }
  if (existing.status === "unsubscribed") {
    return { subscription: existing };
  }

  if (deps.consentCapability) {
    await deps.consentCapability.revoke({ workspaceId: input.workspaceId, subscriberId: existing.subscriberId });
  }

  const now = deps.clock.nowIso();
  const updated: SubscriptionRow = { ...existing, status: "unsubscribed", unsubscribedAt: now, updatedAt: now };
  await deps.subscriptionRepo.save(updated);
  return { subscription: updated };
}


/**
 * C-013 — import a batch (1-500) of subscriber ids, routing EVERY row through the identical
 * `saveSubscription` path (AC-40/EC-08): a batch with one invalid id still creates the valid rows.
 */
export async function importSubscriptions(required: {
  deps: SubscriptionsDeps;
  input: { workspaceId: UUID; listId: UUID; subscribers: readonly { subscriberId: UUID; source: SubscriptionRow["source"] }[] };
}, _optional: Record<string, never> = {}): Promise<{ created: SubscriptionRow[]; failed: { index: number; code: string; message: string }[] }> {
  const { deps, input } = required;
  if (input.subscribers.length < 1 || input.subscribers.length > IMPORT_BATCH_MAX) {
    throw new NewsletterValidationError({
      message: `import batch must be between 1 and ${IMPORT_BATCH_MAX} rows`,
      field: "subscribers",
      reason: "length",
    });
  }
  // Checked ONCE for the whole batch (the same `listId` applies to every row) rather than letting
  // every row independently fail — an unknown list is a malformed-request condition, not a
  // per-row outcome (api.spec.md §6 IMPORT_SUBSCRIPTIONS' 400 is scoped to "malformed batch shape
  // only"; a missing list is closer to that than to a per-row 207 failure entry).
  await requireActiveList({ listRepo: deps.listRepo, workspaceId: input.workspaceId, listId: input.listId });

  const created: SubscriptionRow[] = [];
  const failed: { index: number; code: string; message: string }[] = [];

  for (let index = 0; index < input.subscribers.length; index += 1) {
    const row = input.subscribers[index];
    try {
      if (row === undefined) throw new Error(`Newsletter import has no subscriber at index ${index}`);
      const { subscription } = await saveSubscription({
        deps,
        input: { workspaceId: input.workspaceId, listId: input.listId, subscriberId: row.subscriberId, source: row.source },
      });
      created.push(subscription);
    } catch (err) {
      failed.push(subscriptionImportFailure(err, index));
    }
  }

  return { created, failed };
}

function subscriptionImportFailure(err: unknown, index: number): { index: number; code: string; message: string } {
  if (err instanceof NewsletterSubscriberNotFoundError) {
    return { index, code: "NEWSLETTER_SUBSCRIBER_NOT_FOUND", message: err.message };
  } else {
    return { index, code: "INTERNAL_ERROR", message: (err as Error).message };
  }
}
