import { describe, expect, it } from "vitest";

import {
  toMagicLinkTokenRecord, toMagicLinkTokenRow, toMemberConsentRecord, toMemberConsentRow,
  toConsentRevisionRow, toMemberConsentRevisionRecord, toMemberExternalIdentityRecord, toMemberExternalIdentityRow, toMemberRecord, toMemberRow,
  toMemberSessionRecord, toMemberSessionRow, toMemberTierRecord, toMemberTierRow, toMemberSubscriptionRecord, toMemberSubscriptionRow,
  type MemberRow,
} from "../repo.rows.js";
import type { MemberConsentRevisionRecord } from "../types.js";

/**
 * @file Row <-> record mappings of the member SQL tables: every nullable column round-trips both when
 * present and when absent (NULL in the row, `undefined`/omitted in the record), JSON columns are parsed
 * and serialised, and the member mapping never exposes the stored password hash.
 */
describe("member row mapping", () => {
  const full: MemberRow = {
    id: "m1", workspace_id: "w1", email: "a@example.test", name: "Ada", email_verified_at: "v",
    credentials_revoked_at: "cut", password_hash: "pw-hash", status: "active", note: "n",
    fields_json: '{"plan":"x"}', created_at: "c", updated_at: "u", version: 3,
  };

  it("maps every populated column and never carries the password hash", () => {
    const record = toMemberRecord(full);
    expect(record).toEqual({
      id: "m1", workspaceId: "w1", email: "a@example.test", name: "Ada", emailVerifiedAt: "v",
      credentialsRevokedAt: "cut", status: "active", note: "n", fields: { plan: "x" },
      createdAt: "c", updatedAt: "u", version: 3,
    });
    expect(JSON.stringify(record)).not.toContain("pw-hash");
    const { password_hash: _hidden, ...withoutHash } = full;
    expect(toMemberRow(record)).toEqual(withoutHash);
  });

  it("maps NULL columns to absent record fields and back to NULL", () => {
    const empty: MemberRow = { ...full, name: null, email_verified_at: null, credentials_revoked_at: null, note: null, fields_json: null };
    const record = toMemberRecord(empty);
    expect("credentialsRevokedAt" in record).toBe(false);
    expect(record).toMatchObject({ name: undefined, emailVerifiedAt: undefined, note: undefined, fields: undefined });
    expect(toMemberRow(record)).toMatchObject({ name: null, email_verified_at: null, credentials_revoked_at: null, note: null, fields_json: null });
  });
});

describe("subscription and session row mapping", () => {
  it("round-trips a subscription with and without its optional dates", () => {
    const row = {
      id: "s1", workspace_id: "w1", member_id: "m1", tier_id: "t1", status: "active", source: "manual",
      external_ref: "ext", started_at: "st", current_period_end: "end", canceled_at: "can", created_at: "c", updated_at: "u", version: 2,
    };
    const record = toMemberSubscriptionRecord(row);
    expect(record).toEqual({
      id: "s1", workspaceId: "w1", memberId: "m1", tierId: "t1", status: "active", source: "manual",
      externalRef: "ext", startedAt: "st", currentPeriodEnd: "end", canceledAt: "can", createdAt: "c", updatedAt: "u", version: 2,
    });
    expect(toMemberSubscriptionRow(record)).toEqual(row);
    const bare = { ...row, external_ref: null, current_period_end: null, canceled_at: null };
    expect(toMemberSubscriptionRecord(bare)).toMatchObject({ externalRef: undefined, currentPeriodEnd: undefined, canceledAt: undefined });
    expect(toMemberSubscriptionRow(toMemberSubscriptionRecord(bare))).toEqual(bare);
  });

  it("round-trips a session with and without its optional columns", () => {
    const row = {
      id: "x1", workspace_id: "w1", member_id: "m1", token_hash: "th", created_at: "c", expires_at: "e",
      revoked_at: "r", last_seen_at: "l", user_agent: "ua", ip: "10.0.0.2",
    };
    expect(toMemberSessionRow(toMemberSessionRecord(row))).toEqual(row);
    expect(toMemberSessionRecord(row)).toMatchObject({ revokedAt: "r", lastSeenAt: "l", userAgent: "ua", ip: "10.0.0.2" });
    const bare = { ...row, revoked_at: null, last_seen_at: null, user_agent: null, ip: null };
    expect(toMemberSessionRecord(bare)).toMatchObject({ revokedAt: undefined, lastSeenAt: undefined, userAgent: undefined, ip: undefined });
    expect(toMemberSessionRow(toMemberSessionRecord(bare))).toEqual(bare);
  });
});

describe("magic token, consent and external identity row mapping", () => {
  it("keeps the legacy token shape: no email, code hash or counter keys when unset", () => {
    const row = {
      id: "t1", workspace_id: "w1", member_id: "m1", email: null, token_hash: "lh", code_hash: null,
      failed_attempts: 0, purpose: "signin", created_at: "c", expires_at: "e", consumed_at: null,
    };
    const record = toMagicLinkTokenRecord(row);
    expect(record).toEqual({ id: "t1", workspaceId: "w1", memberId: "m1", tokenHash: "lh", purpose: "signin", createdAt: "c", expiresAt: "e", consumedAt: undefined });
    expect(Object.keys(record)).not.toContain("email");
    expect(toMagicLinkTokenRow(record)).toEqual(row);
    const coded = { ...row, email: "b@example.test", code_hash: "ch", failed_attempts: 3, consumed_at: "k" };
    expect(toMagicLinkTokenRecord(coded)).toMatchObject({ email: "b@example.test", codeHash: "ch", failedAttempts: 3, consumedAt: "k" });
    expect(toMagicLinkTokenRow(toMagicLinkTokenRecord(coded))).toEqual(coded);
  });

  it("parses and serialises consent evidence and keeps optional stamps", () => {
    const row = {
      id: "c1", workspace_id: "w1", member_id: "m1", purpose: "newsletter", status: "granted",
      evidence_json: '{"source":"form"}', granted_at: "g", revoked_at: null, created_at: "c", updated_at: "u", version: 1,
    };
    const record = toMemberConsentRecord(row);
    expect(record).toEqual({
      id: "c1", workspaceId: "w1", memberId: "m1", purpose: "newsletter", status: "granted", evidence: { source: "form" },
      grantedAt: "g", revokedAt: undefined, createdAt: "c", updatedAt: "u", version: 1,
    });
    expect(toMemberConsentRow(record)).toEqual(row);
    const revoked = { ...row, granted_at: null, revoked_at: "r" };
    expect(toMemberConsentRow(toMemberConsentRecord(revoked))).toEqual(revoked);
  });

  it("maps an external identity's unlink marker only when present and writes absence as NULL", () => {
    const row = { id: "i1", workspace_id: "w1", member_id: "m1", provider_id: "p", issuer: "iss", subject: "sub", linked_at: "l", unlinked_at: null };
    const record = toMemberExternalIdentityRecord({ row });
    expect(record).toEqual({ id: "i1", workspaceId: "w1", memberId: "m1", providerId: "p", issuer: "iss", subject: "sub", linkedAt: "l" });
    expect(toMemberExternalIdentityRow({ record })).toEqual(row);
    const unlinked = { ...row, unlinked_at: "gone" };
    expect(toMemberExternalIdentityRecord({ row: unlinked })).toMatchObject({ unlinkedAt: "gone" });
    expect(toMemberExternalIdentityRow({ record: toMemberExternalIdentityRecord({ row: unlinked }) })).toEqual(unlinked);
  });
});

describe("consent revision row mapping", () => {
  it("writes a consent revision with compact JSON snapshots and reads it back", () => {
    const record: Omit<MemberConsentRevisionRecord, "seq"> = {
      workspaceId: "w1", memberId: "m1", consentId: "c1", purpose: "newsletter", op: "consent_confirm",
      beforeJson: null, afterJson: { status: "granted" }, originModule: "mod", createdAt: "c",
    };
    const stored = {
      entity_kind: "consent", entity_id: "c1", workspace_id: "w1", member_id: "m1", purpose: "newsletter",
      op: "consent_confirm", before_json: null, after_json: '{"status":"granted"}', origin_module: "mod", created_at: "c",
    };
    expect(toConsentRevisionRow(record)).toEqual(stored);
    expect(toMemberConsentRevisionRecord({ ...stored, seq: 5 })).toEqual({ ...record, seq: 5 });
    expect(toConsentRevisionRow({ ...record, beforeJson: { a: 1 }, afterJson: null })).toMatchObject({ before_json: '{"a":1}', after_json: null });
  });
});

describe("tier row mapping", () => {
  it("round-trips a portal-visible tier with all optional text and a tier with none", () => {
    const row = {
      id: "t1", workspace_id: "w1", name: "Gold", slug: "gold", type: "paid", status: "active", description: "d",
      welcome_page_path: "/hi", visible_in_portal: 1, monthly_price_cents: 500, yearly_price_cents: 5000, currency: "eur",
      created_at: "c", updated_at: "u", version: 4,
    };
    const record = toMemberTierRecord(row);
    expect(record).toMatchObject({ description: "d", welcomePagePath: "/hi", visibleInPortal: true, currency: "eur", monthlyPriceCents: 500 });
    expect(toMemberTierRow(record)).toEqual(row);
    const bare = { ...row, description: null, welcome_page_path: null, currency: null, visible_in_portal: 0 };
    expect(toMemberTierRecord(bare)).toMatchObject({ description: undefined, welcomePagePath: undefined, currency: undefined, visibleInPortal: false });
    expect(toMemberTierRow(toMemberTierRecord(bare))).toEqual(bare);
    const { monthlyPriceCents: _monthly, yearlyPriceCents: _yearly, ...unpriced } = record;
    expect(toMemberTierRow(unpriced)).toMatchObject({ monthly_price_cents: null, yearly_price_cents: null });
  });
});
