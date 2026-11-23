import { sql } from "kysely";
import { describe, expect, it } from "vitest";

import {
  SqlMagicLinkTokenRepo,
  SqlMemberConsentRepo,
  SqlMemberExternalIdentityRepo,
  SqlMemberRepo,
  SqlMemberSessionRepo,
  SqlMemberSubscriptionRepo,
  SqlMemberTierRepo,
  type KeepStoredRevocationPort,
  type MemberTables,
} from "../repo.js";
import { MemberConflictError } from "../types.js";
import { createSqlHarness } from "./sql-harness.js";

/**
 * @file Pins the member SQL adapters' host seams: every statement targets the host-named tables
 * (including the qualified conflict predicates), and the session upsert writes the host's
 * revocation rule. Statements are compiled over a no-op driver (see `sql-harness.ts`).
 */
const tables: MemberTables = {
  members: "h_members", memberTiers: "h_tiers", memberSubscriptions: "h_subs", memberSessions: "h_sessions",
  memberMagicTokens: "h_tokens", memberConsents: "h_consents", memberRevisions: "h_revisions",
  memberExternalIdentities: "h_identities",
};

const member = {
  id: "m1", workspaceId: "w1", email: "a@example.test", status: "active" as const,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 2,
};

describe("member SQL adapters use the host's table names", () => {
  it("reads and writes members through the named table, with qualified conflict predicates", async () => {
    const h = createSqlHarness();
    const repo = new SqlMemberRepo({ kernel: h.kernel, tables });
    await repo.findById({ workspaceId: "w1", id: "m1" });
    h.queue.push([{}]);
    await repo.save(member);
    expect(h.statements[0]?.sql).toContain('from "h_members"');
    expect(h.statements[1]?.sql).toContain('insert into "h_members"');
    expect(h.statements[1]?.sql).toContain('"h_members"."status" <> ?');
    expect(h.statements[1]?.sql).toContain('"h_members"."version" = ?');
    expect(h.statements[1]?.sql).toContain('"h_members"."credentials_revoked_at" is null');
    expect(h.statements[1]?.parameters).toContain(1);
  });

  it("raises MemberConflictError when the guarded upsert changes no row", async () => {
    const h = createSqlHarness();
    await expect(new SqlMemberRepo({ kernel: h.kernel, tables }).save(member)).rejects.toBeInstanceOf(MemberConflictError);
  });

  it("fences external-identity upserts on the named table", async () => {
    const h = createSqlHarness();
    h.queue.push([{ id: "i1" }]);
    await new SqlMemberExternalIdentityRepo({ kernel: h.kernel, tables }).save({
      id: "i1", workspaceId: "w1", memberId: "m1", providerId: "p", issuer: "iss", subject: "sub", linkedAt: "t",
    });
    expect(h.statements[0]?.sql).toContain('insert into "h_identities"');
    expect(h.statements[0]?.sql).toContain('"h_identities"."unlinked_at" is null');
    expect(h.statements[0]?.sql).toContain('"h_identities"."subject" = ?');
  });

  it("routes tiers, subscriptions, tokens, consents and revisions to their named tables", async () => {
    const h = createSqlHarness();
    await new SqlMemberTierRepo({ kernel: h.kernel, tables }).list({ workspaceId: "w1" });
    await new SqlMemberSubscriptionRepo({ kernel: h.kernel, tables }).listByMember({ workspaceId: "w1", memberId: "m1" });
    await new SqlMagicLinkTokenRepo({ kernel: h.kernel, tables }).findById({ workspaceId: "w1", id: "t1" });
    const consents = new SqlMemberConsentRepo({ kernel: h.kernel, tables });
    await consents.findByMemberAndPurpose({ workspaceId: "w1", memberId: "m1", purpose: "newsletter" as never });
    h.queue.push([{ seq: 4 }]);
    const seq = await consents.appendRevision({
      workspaceId: "w1", memberId: "m1", consentId: "c1", purpose: "newsletter" as never, op: "consent_grant" as never,
      beforeJson: null, afterJson: null, originModule: "test", createdAt: "t",
    });
    const sqls = h.statements.map((s) => s.sql);
    expect(sqls[0]).toContain('from "h_tiers"');
    expect(sqls[1]).toContain('from "h_subs"');
    expect(sqls[2]).toContain('from "h_tokens"');
    expect(sqls[3]).toContain('from "h_consents"');
    expect(sqls[4]).toContain('insert into "h_revisions"');
    expect(seq).toBe(4);
  });
});

describe("session upsert writes the host's revocation rule", () => {
  it("asks the injected rule for the named session table and embeds its expression", async () => {
    const h = createSqlHarness();
    const calls: Array<{ table: string }> = [];
    const keepStoredRevocation: KeepStoredRevocationPort = (required) => {
      calls.push(required);
      return sql<string | null>`KEEP_REVOKED(${sql.ref(`${required.table}.revoked_at`)})`;
    };
    await new SqlMemberSessionRepo({ kernel: h.kernel, tables, keepStoredRevocation }).save({
      id: "s1", workspaceId: "w1", memberId: "m1", tokenHash: "h", createdAt: "t0", expiresAt: "t1",
    });
    expect(h.locks).toEqual(["trash:member:w1:m1"]);
    expect(calls).toEqual([{ table: "h_sessions" }]);
    expect(h.statements[0]?.sql).toContain('from "h_members"');
    expect(h.statements[1]?.sql).toContain('insert into "h_sessions"');
    expect(h.statements[1]?.sql).toContain('"revoked_at" = KEEP_REVOKED("h_sessions"."revoked_at")');
  });
});
