import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  checkConsent,
  confirmConsent,
  requestConsent,
  revokeConsent,
  type ConsentServiceDeps,
} from "../consent-service.js";
import { InMemoryMemberConsentRepo, InMemoryMemberRepo } from "../repo.memory.js";
import { MemberNotFoundError, type ConsentEvidence, type MemberRecord } from "../types.js";

const WORKSPACE_ID = "workspace-1";
const MEMBER_ID = "member-1";
const PURPOSE = "newsletter:list-1";
const FIRST_NOW = "2026-11-27T12:00:00.000Z";

const member: MemberRecord = {
  id: MEMBER_ID,
  workspaceId: WORKSPACE_ID,
  email: "reader@example.test",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 1,
};

const requestedEvidence: ConsentEvidence = {
  source: "signup-form",
  consentTextRef: "copy-v1",
  ip: "192.0.2.1",
};

function fixture() {
  let nowMs = Date.parse(FIRST_NOW);
  let nextId = 0;
  const consents = new InMemoryMemberConsentRepo();
  const deps: ConsentServiceDeps = {
    clock: { nowMs: () => nowMs },
    ids: { newId: () => `consent-${++nextId}` },
    members: new InMemoryMemberRepo({}, { initialRows: [member] }),
    consents,
  };
  return {
    deps,
    consents,
    advanceTo(iso: string) { nowMs = Date.parse(iso); },
  };
}

function input(evidence: ConsentEvidence = requestedEvidence) {
  return { workspaceId: WORKSPACE_ID, memberId: MEMBER_ID, purpose: PURPOSE, evidence, originModule: "newsletter" };
}

describe("member consent service", () => {
  test("request, confirm, and revoke persist the lifecycle and an attributed revision ledger", async () => {
    const { deps, consents, advanceTo } = fixture();

    const requested = await requestConsent({ deps, input: input() });
    assert.deepEqual(requested.consent, {
      id: "consent-1", workspaceId: WORKSPACE_ID, memberId: MEMBER_ID, purpose: PURPOSE,
      status: "pending", evidence: requestedEvidence, createdAt: FIRST_NOW, updatedAt: FIRST_NOW, version: 1,
    });

    const confirmNow = "2026-11-27T12:01:00.000Z";
    const confirmedEvidence = { source: "confirmation-link", confirmTokenId: "token-1" };
    advanceTo(confirmNow);
    const confirmed = await confirmConsent({ deps, input: input(confirmedEvidence) });
    assert.deepEqual(confirmed.consent, {
      ...requested.consent, status: "granted", evidence: confirmedEvidence,
      grantedAt: confirmNow, updatedAt: confirmNow, version: 2,
    });

    const revokeNow = "2026-11-27T12:02:00.000Z";
    advanceTo(revokeNow);
    const revoked = await revokeConsent({ deps, input: { workspaceId: WORKSPACE_ID, memberId: MEMBER_ID, purpose: PURPOSE } });
    assert.deepEqual(revoked.consent, {
      ...confirmed.consent, status: "revoked", revokedAt: revokeNow, updatedAt: revokeNow, version: 3,
    });
    assert.deepEqual(await consents.listRevisions({ workspaceId: WORKSPACE_ID, memberId: MEMBER_ID }), [
      { seq: 1, workspaceId: WORKSPACE_ID, memberId: MEMBER_ID, consentId: "consent-1", purpose: PURPOSE,
        op: "consent_request", beforeJson: null, afterJson: { status: "pending" }, originModule: "newsletter", createdAt: FIRST_NOW },
      { seq: 2, workspaceId: WORKSPACE_ID, memberId: MEMBER_ID, consentId: "consent-1", purpose: PURPOSE,
        op: "consent_confirm", beforeJson: { status: "pending" }, afterJson: { status: "granted" }, originModule: "newsletter", createdAt: confirmNow },
      { seq: 3, workspaceId: WORKSPACE_ID, memberId: MEMBER_ID, consentId: "consent-1", purpose: PURPOSE,
        op: "consent_revoke", beforeJson: { status: "granted" }, afterJson: { status: "revoked" }, originModule: "members", createdAt: revokeNow },
    ]);
  });

  test("a repeated request resets the same consent to pending without erasing its creation time", async () => {
    const { deps, consents, advanceTo } = fixture();
    await requestConsent({ deps, input: input() });
    await confirmConsent({ deps, input: input({ source: "confirmation" }) });
    const resetNow = "2026-11-28T09:00:00.000Z";
    const replacementEvidence = { source: "preferences", consentTextHash: "sha256:new" };
    advanceTo(resetNow);

    const result = await requestConsent({ deps, input: input(replacementEvidence) });

    assert.deepEqual(result.consent, {
      id: "consent-1", workspaceId: WORKSPACE_ID, memberId: MEMBER_ID, purpose: PURPOSE,
      status: "pending", evidence: replacementEvidence, createdAt: FIRST_NOW, updatedAt: resetNow, version: 3,
      grantedAt: undefined, revokedAt: undefined,
    });
    const revisions = await consents.listRevisions({ workspaceId: WORKSPACE_ID, memberId: MEMBER_ID });
    assert.deepEqual(revisions.at(-1)?.beforeJson, { status: "granted" });
  });

  test("confirmation requires a fresh pending request and never creates a consent row", async () => {
    const { deps, consents } = fixture();

    await assert.rejects(() => confirmConsent({ deps, input: input() }), (error: unknown) =>
      error instanceof MemberNotFoundError &&
      error.message === `no pending consent request found for member '${MEMBER_ID}' / purpose '${PURPOSE}'`);
    assert.equal(await consents.findByMemberAndPurpose({ workspaceId: WORKSPACE_ID, memberId: MEMBER_ID, purpose: PURPOSE }), null);

    await requestConsent({ deps, input: input() });
    await confirmConsent({ deps, input: input({ source: "confirmation" }) });
    await assert.rejects(() => confirmConsent({ deps, input: input({ source: "replay" }) }), MemberNotFoundError);
    assert.equal((await consents.listRevisions({ workspaceId: WORKSPACE_ID, memberId: MEMBER_ID })).length, 2);
  });

  test("request rejects an unknown member without writing consent or a revision", async () => {
    const { deps, consents } = fixture();
    const unknown = { ...input(), memberId: "missing-member" };

    await assert.rejects(() => requestConsent({ deps, input: unknown }), (error: unknown) =>
      error instanceof MemberNotFoundError && error.message === "member 'missing-member' was not found");
    assert.equal(await consents.findByMemberAndPurpose({ workspaceId: WORKSPACE_ID, memberId: "missing-member", purpose: PURPOSE }), null);
    assert.deepEqual(await consents.listRevisions({ workspaceId: WORKSPACE_ID, memberId: "missing-member" }), []);
  });

  test("revoke requires an existing record and is idempotent once revoked", async () => {
    const { deps, consents } = fixture();
    const revokeInput = { workspaceId: WORKSPACE_ID, memberId: MEMBER_ID, purpose: PURPOSE };
    await assert.rejects(() => revokeConsent({ deps, input: revokeInput }), (error: unknown) =>
      error instanceof MemberNotFoundError &&
      error.message === `no consent record found for member '${MEMBER_ID}' / purpose '${PURPOSE}'`);
    await requestConsent({ deps, input: input() });
    const first = await revokeConsent({ deps, input: revokeInput });
    const second = await revokeConsent({ deps, input: revokeInput });

    assert.deepEqual(second, first);
    assert.equal((await consents.listRevisions({ workspaceId: WORKSPACE_ID, memberId: MEMBER_ID })).length, 2);
  });

  test("check returns none for a missing row and the stored status for an existing row", async () => {
    const { deps } = fixture();
    const checkInput = { workspaceId: WORKSPACE_ID, memberId: MEMBER_ID, purpose: PURPOSE };
    assert.deepEqual(await checkConsent({ deps, input: checkInput }), { status: "none" });
    await requestConsent({ deps, input: input() });
    assert.deepEqual(await checkConsent({ deps, input: checkInput }), { status: "pending" });
  });
});
