/**
 * @file `MembersSubscriberDirectory` — Members' implementation of Newsletter's
 * `SubscriberDirectoryPort` read seam (ADR-030 §4 entitlement axis; ADR-034 OPEN-1).
 *
 * Purpose:
 * Newsletter's `apps/website/src/features/newsletter/ports.ts` declares `SubscriberDirectoryPort` as the
 * read-only seam it needs into Members to resolve a subscriber's address/deliverability
 * at audience-materialization time. This file is the one real implementation Members
 * owns for that seam — `subscriberId` IS `memberId` (ADR-030: "Publish
 * `AudienceDirectoryPort` (`getContacts→{memberId,email,emailDeliverable}`);
 * `subscriberId = memberId`").
 *
 * Scope note — GLOBAL suppression only (ADR-030 D1c is NOT implemented here):
 * ADR-030 §D1c (LOCKED 4-0) describes a purpose-keyed `member_consents` ledger and a
 * `consentPurpose`-scoped `getContacts` filter. That ledger does not exist anywhere in
 * this codebase (`grep -rln consent src/members/` is empty) — building it is out of
 * scope for this seam. What IS implemented is D1c's other half, the GLOBAL rule:
 * "Global `emailDeliverable`/suppression = active ∧ verified ∧ no global suppression."
 * `MemberRecord`/`MemberSubscriptionRecord` carry no suppression/unsubscribed-globally
 * field today (confirmed: no "suppress" hit in `apps/website/src/features/members/types.ts` or `ports.ts`),
 * so the "no global suppression" clause is currently vacuously true — disclosed here
 * rather than inventing a new `MemberRecord` field, which would be a schema change
 * needing its own decision. `emailDeliverable` below reduces to `active ∧ verified`
 * until a suppression concept is added to `MemberRecord` (or a dedicated ledger).
 *
 * Architectural role:
 * Single-evaluator typed dependency per `apps/website/src/features/newsletter/ports.ts`'s header comment —
 * NOT a second `SubscriberDirectoryPort` adapter (no ADR-006 rule-of-two obligation).
 * Depends only on `MemberRepoPort` (read-only); never touches `MemberSubscriptionRepoPort`
 * because global deliverability does not depend on tier/subscription state, only on the
 * member account's own lifecycle fields.
 *
 * Resource-bounds note (backend-implementation 5a4): `MemberRepoPort` exposes no
 * batch/multi-id lookup, so `getContacts` loops `findById` once per requested id. This
 * is an N+1 pattern; it is accepted here rather than adding a new repo method because
 * the only known caller (the newsletter outbox worker, `SendBatchJob.sendIds`) already
 * slices a campaign's audience into bounded per-job batches before calling this seam —
 * the collection size is bounded upstream by that design, not by this file. If a caller
 * ever passes a whole-campaign-sized `subscriberIds` array directly, a batched
 * `MemberRepoPort.findByIds` method should be added instead of parallelizing unbounded
 * `Promise.all` fan-out here. Flagged as a future N+1 concern, not fixed in this task.
 */
import type { SubscriberContact, SubscriberDirectoryPort } from "../newsletter/ports.js";
import type { MemberRepoPort } from "./ports.js";
import type { MemberRecord } from "./types.js";

export interface MembersSubscriberDirectoryDeps {
  members: MemberRepoPort;
}

/**
 * Global email-deliverability rule (ADR-030 D1c, global half only): a member is
 * deliverable when their account is `active` AND their email has been verified.
 * The "no global suppression" clause is vacuously true until a suppression concept
 * exists on `MemberRecord` — see the file header for why that is not added here.
 *
 * @complexity O(1); pure function of the two `MemberRecord` fields it reads.
 * @overallScore 100
 */
function isEmailDeliverable(member: MemberRecord): boolean {
  return member.status === "active" && Boolean(member.emailVerifiedAt);
}

/**
 * Project a `MemberRecord` into the `SubscriberContact` shape Newsletter consumes.
 * `subscriberId` is the member's principal id; `subscriberId = memberId` (ADR-030).
 *
 * @complexity O(1).
 * @overallScore 100
 */
function toSubscriberContact(member: MemberRecord): SubscriberContact {
  return {
    subscriberId: member.id,
    workspaceId: member.workspaceId,
    email: member.email,
    emailDeliverable: isEmailDeliverable(member),
  };
}

/**
 * Members' implementation of `SubscriberDirectoryPort` (`../newsletter/ports.ts`).
 * Read-only: never writes subscriber identity/consent, only resolves contact info
 * for Newsletter's audience snapshot. See file header for the D1c global-only scope.
 *
 * @overallScore 100
 */
export class MembersSubscriberDirectory implements SubscriberDirectoryPort {
  private readonly deps: MembersSubscriberDirectoryDeps;
  constructor(deps: MembersSubscriberDirectoryDeps) {
    this.deps = deps;
  }

  /**
   * Resolve one subscriber's contact by id. `subscriberId` is looked up as a
   * `memberId` (ADR-030: `subscriberId = memberId`). Returns `null` when no member
   * exists for that id in the workspace — Newsletter is expected to treat a `null`
   * contact as undeliverable/skip, not as an error (no such member to suppress).
   *
   * @complexity O(1) — one `MemberRepoPort.findById` call.
   */
  async getContact(required: {
    workspaceId: string;
    subscriberId: string;
  }): Promise<SubscriberContact | null> {
    const member = await this.deps.members.findById({
      workspaceId: required.workspaceId,
      id: required.subscriberId,
    });
    return member ? toSubscriberContact(member) : null;
  }

  /**
   * Batch-resolve subscriber contacts. Unknown ids are silently omitted from the
   * result (the return shape is `readonly SubscriberContact[]`, not keyed by id) —
   * a Newsletter audience snapshot simply excludes rows for members that no longer
   * exist, rather than failing the whole batch over one stale id.
   *
   * @complexity O(k) sequential-await-free `findById` calls, k = `subscriberIds.length`.
   * See the file-header resource-bounds note: this is an accepted N+1 pattern bounded
   * by the caller's batch size, not by this method.
   */
  async getContacts(required: {
    workspaceId: string;
    subscriberIds: readonly string[];
  }): Promise<readonly SubscriberContact[]> {
    const members = await Promise.all(
      required.subscriberIds.map((subscriberId) =>
        this.deps.members.findById({ workspaceId: required.workspaceId, id: subscriberId })
      )
    );
    return members.filter((member): member is MemberRecord => member !== null).map(toSubscriberContact);
  }
}
