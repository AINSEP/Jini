import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { MembersWriteServiceDeps } from "./ports.js";
import { MemberConflictError, MemberNotFoundError, MemberValidationError, type MemberRecord, type MemberSubscriptionRecord, type MemberSubscriptionStatus } from "./types.js";

const VALID_SUBSCRIPTION_STATUSES: readonly MemberSubscriptionStatus[] = [
  "active",
  "canceled",
  "expired",
  "comped",
];

/**
 * Operator/self profile update (validated, revision-recorded via `save`).
 * @complexity O(1).
 * @overallScore 100
 */
export async function updateProfile(required: {
  deps: MembersWriteServiceDeps;
  input: { workspaceId: string; memberId: string; name?: string; note?: string };
}, _options: Record<string, never> = {}): Promise<{ member: MemberRecord }> {
  const { deps, input } = required;
  const existing = await deps.members.findById({ workspaceId: input.workspaceId, id: input.memberId });
  if (!existing) {
    throw new MemberNotFoundError(`member '${input.memberId}' was not found`);
  }

  let name = existing.name;
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) {
      throw new MemberValidationError("name must not be blank when provided");
    }
    name = trimmed;
  }

  const note = input.note !== undefined ? input.note.trim() : existing.note;

  const member: MemberRecord = {
    ...existing,
    name,
    note,
    updatedAt: clockNowIso({ clock: deps.clock }),
    version: existing.version + 1,
  };
  await deps.members.save(member);

  return { member };
}

/**
 * Operator: disable a member (ADR-021 §5 disable-only, never hard-delete).
 * Idempotent — disabling an already-disabled member is a no-op, not an error.
 * Also revokes every live session for the member so a disabled account cannot
 * keep reading gated content through a session minted before the disable.
 *
 * @complexity O(s), s = the member's live session count (small, per-member).
 * @overallScore 100
 */
export async function disableMember(required: {
  deps: MembersWriteServiceDeps;
  input: { workspaceId: string; memberId: string };
}, _options: Record<string, never> = {}): Promise<{ member: MemberRecord }> {
  const { deps, input } = required;
  const existing = await deps.members.findById({ workspaceId: input.workspaceId, id: input.memberId });
  if (!existing) {
    throw new MemberNotFoundError(`member '${input.memberId}' was not found`);
  }

  if (existing.status === "disabled") {
    return { member: existing };
  }

  const nowIso = clockNowIso({ clock: deps.clock });
  const member: MemberRecord = {
    ...existing,
    status: "disabled",
    credentialsRevokedAt: nowIso,
    updatedAt: nowIso,
    version: existing.version + 1,
  };
  await deps.members.save(member);
  await deps.sessions.revokeAllForMember({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    revokedAt: nowIso,
  });

  return { member };
}

/**
 * Operator: grant a comp subscription. Rejects an archived tier and rejects a
 * duplicate active/comped subscription to the same tier (aggregate invariant:
 * a member cannot hold two simultaneous entitlements to one tier).
 *
 * @complexity O(k), k = the member's active-subscription count (duplicate check).
 * @overallScore 100
 */
export async function compSubscription(required: {
  deps: MembersWriteServiceDeps;
  input: { workspaceId: string; memberId: string; tierId: string };
}, _options: Record<string, never> = {}): Promise<{ subscription: MemberSubscriptionRecord }> {
  const { deps, input } = required;
  const member = await deps.members.findById({ workspaceId: input.workspaceId, id: input.memberId });
  if (!member) {
    throw new MemberNotFoundError(`member '${input.memberId}' was not found`);
  }

  const tier = await deps.tiers.findById({ workspaceId: input.workspaceId, id: input.tierId });
  if (!tier) {
    throw new MemberNotFoundError(`tier '${input.tierId}' was not found`);
  }
  if (tier.status !== "active") {
    throw new MemberValidationError(`tier '${input.tierId}' is archived and cannot accept new subscriptions`);
  }

  const nowIso = clockNowIso({ clock: deps.clock });
  const activeSubscriptions = await deps.subscriptions.listActiveByMember({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    nowIso,
  });
  if (activeSubscriptions.some((subscription) => subscription.tierId === input.tierId)) {
    throw new MemberConflictError(
      `member '${input.memberId}' already has an active subscription to tier '${input.tierId}'`
    );
  }

  const subscription: MemberSubscriptionRecord = {
    id: deps.ids.newId(),
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    tierId: input.tierId,
    status: "comped",
    source: "comp",
    startedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  };
  await deps.subscriptions.save(subscription);

  return { subscription };
}

/**
 * Change a subscription's status (cancel/expire; also the entry point a future
 * billing plugin uses for `source='billing'` rows — ADR-030 §6).
 *
 * @complexity O(1).
 * @overallScore 100
 */
export async function setSubscriptionStatus(required: {
  deps: MembersWriteServiceDeps;
  input: {
    workspaceId: string;
    subscriptionId: string;
    status: MemberSubscriptionStatus;
    externalRef?: string;
  };
}, _options: Record<string, never> = {}): Promise<{ subscription: MemberSubscriptionRecord }> {
  const { deps, input } = required;
  const existing = await deps.subscriptions.findById({
    workspaceId: input.workspaceId,
    id: input.subscriptionId,
  });
  if (!existing) {
    throw new MemberNotFoundError(`subscription '${input.subscriptionId}' was not found`);
  }
  if (!VALID_SUBSCRIPTION_STATUSES.includes(input.status)) {
    throw new MemberValidationError(`'${input.status}' is not a valid subscription status`);
  }

  const nowIso = clockNowIso({ clock: deps.clock });
  const subscription: MemberSubscriptionRecord = {
    ...existing,
    status: input.status,
    externalRef: input.externalRef ?? existing.externalRef,
    canceledAt: input.status === "canceled" ? nowIso : existing.canceledAt,
    updatedAt: nowIso,
    version: existing.version + 1,
  };
  await deps.subscriptions.save(subscription);

  return { subscription };
}
