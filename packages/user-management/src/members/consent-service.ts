import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
/**
 * @file The D1c consent chokepoint (ADR-PIPE-013 Decision §4, crosscutting
 * sweep D1c LOCKED 4-0).
 *
 * Purpose:
 * `requestConsent`/`confirmConsent`/`revokeConsent`/`checkConsent` — the ONLY
 * write path to `member_consents`. Kept separate from `write-service.ts`
 * because consent has a distinct actor model: a caller *other than* the
 * member or an operator (e.g. Newsletter, a sibling Tier-2 core module)
 * requests/confirms on the member's behalf, attributed via an explicit
 * `originModule` field rather than `write-service.ts`'s operator/member actor
 * split.
 *
 * INV-NEW-02 (the one invariant this whole file exists to enforce): no caller
 * may assert `status: 'granted'` directly — the only path is `requestConsent`
 * (creates `pending`) then `confirmConsent` (transitions `pending -> granted`,
 * and ONLY from `pending`). `confirmConsent` with no fresh matching pending
 * row — whether none was ever requested, or the purpose already reached a
 * terminal `granted`/`revoked` state — throws `MemberNotFoundError` and
 * creates no row, mirroring `write-service.ts`'s existing not-found error
 * shape rather than inventing a new error class for this one module.
 *
 * Every write here appends a same-tx `member_revisions` row (`entity_kind
 * ='consent'`) via `MemberConsentRepoPort.transaction`, matching the
 * ADR-022 §4a / ADR-028 §4 write-chokepoint discipline every other
 * core-owned mutation in this repo already follows.
 */
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort } from "@jini-ai/core/primitives";
import type { MemberConsentRepoPort, MemberRepoPort } from "./ports.js";
import {
  MemberNotFoundError,
  type ConsentEvidence,
  type ConsentPurpose,
  type MemberConsentRecord,
} from "./types.js";

/** Deps `consent-service.ts` needs — a distinct bundle from `MembersWriteServiceDeps` (no mailer/sessions/tiers). */
export interface ConsentServiceDeps {
  clock: ClockPort;
  ids: IdGeneratorPort;
  members: MemberRepoPort;
  consents: MemberConsentRepoPort;
}

async function assertMemberExists({ deps, workspaceId, memberId }: { deps: ConsentServiceDeps; workspaceId: string; memberId: string }, _optional = {}): Promise<void> {
  const member = await deps.members.findById({ workspaceId, id: memberId });
  if (!member) {
    throw new MemberNotFoundError(`member '${memberId}' was not found`);
  }
}

function buildPendingConsent({ deps, input, existing, nowIso }: {
  deps: ConsentServiceDeps; input: Parameters<typeof requestConsent>[0]["input"];
  existing: Awaited<ReturnType<ConsentServiceDeps["consents"]["findByMemberAndPurpose"]>>; nowIso: string;
}): MemberConsentRecord {
  const consent: MemberConsentRecord = existing
    ? {
        ...existing,
        status: "pending",
        evidence: input.evidence,
        grantedAt: undefined,
        revokedAt: undefined,
        updatedAt: nowIso,
        version: existing.version + 1,
      }
    : {
        id: deps.ids.newId(),
        workspaceId: input.workspaceId,
        memberId: input.memberId,
        purpose: input.purpose,
        status: "pending",
        evidence: input.evidence,
        createdAt: nowIso,
        updatedAt: nowIso,
        version: 1,
      };

  return consent;
}

/**
 * Begin a consent request: creates (or resets) a `status: 'pending'` row for
 * `(memberId, purpose)` and appends a `consent_request` revision, in the same
 * `transaction()` call.
 *
 * @complexity O(1) — one member lookup, one consent lookup, one upsert, one revision append.
 * @overallScore 100
 */
export async function requestConsent(required: {
  deps: ConsentServiceDeps;
  input: {
    workspaceId: string;
    memberId: string;
    purpose: ConsentPurpose;
    evidence: ConsentEvidence;
    originModule: string;
  };
}, _optional: Record<string, never> = {}): Promise<{ consent: MemberConsentRecord }> {
  const { deps, input } = required;
  await assertMemberExists({ deps, workspaceId: input.workspaceId, memberId: input.memberId });

  const nowIso = clockNowIso({ clock: deps.clock });
  const existing = await deps.consents.findByMemberAndPurpose({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    purpose: input.purpose,
  });

  const consent = buildPendingConsent({ deps, input, existing, nowIso });

  await deps.consents.transaction({ fn: async () => {
    await deps.consents.save(consent);
    await deps.consents.appendRevision({
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      consentId: consent.id,
      purpose: input.purpose,
      op: "consent_request",
      beforeJson: existing ? { status: existing.status } : null,
      afterJson: { status: consent.status },
      originModule: input.originModule,
      createdAt: nowIso,
    });
  } });

  return { consent };
}

/**
 * Confirm a previously-requested consent: `pending -> granted`. The ONLY
 * function that may write `status: 'granted'` (INV-NEW-02) — see file header.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export async function confirmConsent(required: {
  deps: ConsentServiceDeps;
  input: {
    workspaceId: string;
    memberId: string;
    purpose: ConsentPurpose;
    evidence: ConsentEvidence;
    originModule: string;
  };
}, _optional: Record<string, never> = {}): Promise<{ consent: MemberConsentRecord }> {
  const { deps, input } = required;
  await assertMemberExists({ deps, workspaceId: input.workspaceId, memberId: input.memberId });

  const existing = await deps.consents.findByMemberAndPurpose({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    purpose: input.purpose,
  });
  if (!existing || existing.status !== "pending") {
    // No fresh `requestConsent` to confirm — INV-NEW-02 forbids silently
    // creating a granted row here. Mirrors `write-service.ts`'s not-found
    // error shape rather than inventing a new error class for this module.
    throw new MemberNotFoundError(
      `no pending consent request found for member '${input.memberId}' / purpose '${input.purpose}'`
    );
  }

  const nowIso = clockNowIso({ clock: deps.clock });
  const consent: MemberConsentRecord = {
    ...existing,
    status: "granted",
    evidence: input.evidence,
    grantedAt: nowIso,
    updatedAt: nowIso,
    version: existing.version + 1,
  };

  await deps.consents.transaction({ fn: async () => {
    await deps.consents.save(consent);
    await deps.consents.appendRevision({
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      consentId: consent.id,
      purpose: input.purpose,
      op: "consent_confirm",
      beforeJson: { status: existing.status },
      afterJson: { status: consent.status },
      originModule: input.originModule,
      createdAt: nowIso,
    });
  } });

  return { consent };
}

/**
 * Revoke a granted (or already-revoked) consent. Idempotent — revoking an
 * already-revoked purpose is a no-op (no write, no new revision row),
 * matching `disableMember`'s idempotency convention. Requires an existing
 * consent record (mirrors `disableMember` requiring an existing member);
 * a purpose with no consent record at all throws `MemberNotFoundError`.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export async function revokeConsent(required: {
  deps: ConsentServiceDeps;
  input: { workspaceId: string; memberId: string; purpose: ConsentPurpose };
}, _optional: Record<string, never> = {}): Promise<{ consent: MemberConsentRecord }> {
  const { deps, input } = required;
  const existing = await deps.consents.findByMemberAndPurpose({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    purpose: input.purpose,
  });
  if (!existing) {
    throw new MemberNotFoundError(
      `no consent record found for member '${input.memberId}' / purpose '${input.purpose}'`
    );
  }

  if (existing.status === "revoked") {
    return { consent: existing };
  }

  const nowIso = clockNowIso({ clock: deps.clock });
  const consent: MemberConsentRecord = {
    ...existing,
    status: "revoked",
    revokedAt: nowIso,
    updatedAt: nowIso,
    version: existing.version + 1,
  };

  await deps.consents.transaction({ fn: async () => {
    await deps.consents.save(consent);
    await deps.consents.appendRevision({
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      consentId: consent.id,
      purpose: input.purpose,
      op: "consent_revoke",
      beforeJson: { status: existing.status },
      afterJson: { status: consent.status },
      // No caller-supplied originModule for revoke (Decision §4's signature has none) — attribute
      // to the module that owns this chokepoint itself.
      originModule: "members",
      createdAt: nowIso,
    });
  } });

  return { consent };
}

/**
 * Read the current consent status for `(memberId, purpose)`. Total function —
 * never throws, returns `{status:'none'}` when no row exists (Contract Map
 * C-006). No member-existence check: a pure read, safe to call for any id.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export async function checkConsent(required: {
  deps: ConsentServiceDeps;
  input: { workspaceId: string; memberId: string; purpose: ConsentPurpose };
}, _optional: Record<string, never> = {}): Promise<{ status: MemberConsentRecord["status"] | "none" }> {
  const { deps, input } = required;
  const existing = await deps.consents.findByMemberAndPurpose({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    purpose: input.purpose,
  });
  return { status: existing?.status ?? "none" };
}
