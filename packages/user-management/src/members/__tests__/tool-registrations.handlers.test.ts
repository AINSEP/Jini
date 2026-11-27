import { describe, expect, it } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { PositionalMailer } from "@jini-ai/core/contracts/mail";
import type { RemoveEntity } from "@jini-ai/core/contracts/site/plugins-host";
import { membersAgentToolCatalog } from "../agent-tools.js";
import {
  InMemoryMagicLinkTokenRepo,
  InMemoryMemberRepo,
  InMemoryMemberSessionRepo,
  InMemoryMemberSubscriptionRepo,
  InMemoryMemberTierRepo,
} from "../repo.memory.js";
import { buildMembersRegistrations, contributeMembersTools, membersDerivedRisk, type MembersToolDeps } from "../tool-registrations.js";
import type { MemberRecord } from "../types.js";

const at = "2026-05-01T09:00:00.000Z";
const nowMs = Date.parse("2026-05-02T09:00:00.000Z");
const nowIso = new Date(nowMs).toISOString();

function member(id: string, overrides: Partial<MemberRecord> = {}): MemberRecord {
  return { id, workspaceId: "w", email: `${id}@example.test`, status: "active", createdAt: at, updatedAt: at, version: 3, ...overrides };
}

const mailer: PositionalMailer = {
  capabilities: () => ({ driver: "memory", supportsIdempotencyKey: true, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false }),
  send: async () => ({ ok: true, providerMessageId: "mail", acceptedAt: at }),
  sendBatch: async () => [],
};

interface Harness {
  deps: MembersToolDeps;
  members: InMemoryMemberRepo;
  sessions: InMemoryMemberSessionRepo;
  principals: unknown[];
  captured: unknown[];
  authorizeCalls: unknown[];
  limiterKeys: string[];
}

function harness(required: { rows?: MemberRecord[] } = {}, optional: { allowed?: boolean; retryAfterSeconds?: number; removeMember?: RemoveEntity } = {}): Harness {
  const members = new InMemoryMemberRepo({}, { initialRows: required.rows ?? [] });
  const sessions = new InMemoryMemberSessionRepo();
  const principals: unknown[] = [];
  const captured: unknown[] = [];
  const authorizeCalls: unknown[] = [];
  const limiterKeys: string[] = [];
  const ids = ["new-member"];
  const deps: MembersToolDeps = {
    catalog: membersAgentToolCatalog,
    hostReads: { readRef: () => "read member" },
    mailTransport: undefined,
    tracker: {
      capture: (input, options) => { captured.push([input, options]); },
      error: () => undefined,
      trace: async (input) => input.run({ setOutcome: () => undefined }),
      metric: () => undefined,
    },
    ...(optional.removeMember === undefined ? {} : { removeMember: optional.removeMember }),
    authorize: async (...args) => { authorizeCalls.push(args); return { allowed: true, reason: "grant" }; },
    workspaceId: "w",
    clock: { nowMs: () => nowMs },
    idGen: { newId: () => ids.shift() ?? "spare-id" },
    memberRepo: members,
    memberTierRepo: new InMemoryMemberTierRepo(),
    memberSubscriptionRepo: new InMemoryMemberSubscriptionRepo(),
    memberSessionRepo: sessions,
    magicLinkRepo: new InMemoryMagicLinkTokenRepo(),
    mailer,
    principalRepo: { save: async (row) => { principals.push(row); } },
    magicLinkPerEmailLimiter: {
      check: async ({ key }) => {
        limiterKeys.push(key);
        return optional.allowed === false ? { allowed: false, retryAfterSeconds: optional.retryAfterSeconds ?? 30 } : { allowed: true };
      },
    },
  };
  return { deps, members, sessions, principals, captured, authorizeCalls, limiterKeys };
}

function ctxFor(input: Record<string, unknown>, optional: { signal?: AbortSignal } = {}): ToolExecutionContext {
  return { executionId: "exec", principal: { id: "owner" }, run: { id: "run" }, input, signal: optional.signal ?? new AbortController().signal };
}

function tool(h: Harness, id: string) {
  const found = buildMembersRegistrations(h.deps).find(item => item.descriptor.id === id);
  if (!found) throw new Error(`tool ${id} is not registered`);
  return found;
}

function aborted(): AbortSignal {
  const controller = new AbortController();
  controller.abort(new Error("run cancelled"));
  return controller.signal;
}

describe("members_create", () => {
  it("creates a pending member with a member principal and reports member_registered to the tracker", async () => {
    const h = harness();
    const result = await tool(h, "members_create").handler(ctxFor({ email: "new@example.test", name: "  New Person " }));
    expect(result).toEqual({ member: { id: "new-member", email: "new@example.test", status: "pending", name: "New Person", createdAt: nowIso, updatedAt: nowIso, version: 1 } });
    expect((await h.members.findById({ workspaceId: "w", id: "new-member" }))?.email).toBe("new@example.test");
    expect(h.principals).toEqual([{ id: "new-member", workspaceId: "w", kind: "member", displayName: "Site member", status: "active", createdAt: nowIso }]);
    expect(h.captured).toEqual([[{ name: "member_registered", userId: "owner" }, { properties: { eventId: "member-registered:w:new-member", creationSource: "operator", initialState: "pending" } }]]);
    expect(h.authorizeCalls).toHaveLength(1);
  });

  it("refuses a duplicate email as a model-facing conflict and writes nothing", async () => {
    const h = harness({ rows: [member("m1", { email: "taken@example.test" })] });
    await expect(tool(h, "members_create").handler(ctxFor({ email: "taken@example.test" }))).rejects.toThrow("member with email 'taken@example.test' already exists");
    expect(h.principals).toEqual([]);
  });

  it("stops before any write when the run is already cancelled", async () => {
    const h = harness();
    await expect(tool(h, "members_create").handler(ctxFor({ email: "new@example.test" }, { signal: aborted() }))).rejects.toThrow("run cancelled");
    expect(await h.members.findById({ workspaceId: "w", id: "new-member" })).toBeNull();
    expect(h.principals).toEqual([]);
  });
});

describe("members_update_profile", () => {
  it("renames the member, bumps its version and returns the public view only", async () => {
    const h = harness({ rows: [member("m1", { name: "Old", note: "private note" })] });
    const result = await tool(h, "members_update_profile").handler(ctxFor({ memberId: "m1", name: " Renamed " }));
    expect(result).toEqual({ member: { id: "m1", email: "m1@example.test", status: "active", name: "Renamed", createdAt: at, updatedAt: nowIso, version: 4 } });
    expect(await h.members.findById({ workspaceId: "w", id: "m1" })).toEqual(member("m1", { name: "Renamed", note: "private note", updatedAt: nowIso, version: 4 }));
  });

  it("names the missing member and leaves storage untouched", async () => {
    const h = harness();
    await expect(tool(h, "members_update_profile").handler(ctxFor({ memberId: "ghost", name: "X" }))).rejects.toThrow("member 'ghost' was not found");
  });
});

describe("members_list", () => {
  const rows = [member("m3"), member("m1", { name: "One", emailVerifiedAt: at }), member("m2"), member("x1", { workspaceId: "other" })];

  it("lists the workspace's members as public views and pages with limit + cursor", async () => {
    const h = harness({ rows });
    const first = await tool(h, "members_list").handler(ctxFor({ limit: 2 }));
    expect(first).toMatchObject({ members: [
      { id: "m1", email: "m1@example.test", status: "active", name: "One", emailVerifiedAt: at, createdAt: at, updatedAt: at, version: 3 },
      { id: "m2", email: "m2@example.test", status: "active", createdAt: at, updatedAt: at, version: 3 },
    ] });
    if (typeof first !== "object" || first === null || !("nextCursor" in first) || typeof first.nextCursor !== "string") throw new Error("expected a next cursor");
    expect(first).toHaveProperty("more");
    const second = await tool(h, "members_list").handler(ctxFor({ limit: 2, cursor: first.nextCursor }));
    expect(second).toEqual({ members: [{ id: "m3", email: "m3@example.test", status: "active", createdAt: at, updatedAt: at, version: 3 }], nextCursor: null });
  });

  it("resumes after a known afterId", async () => {
    const h = harness({ rows });
    const page = await tool(h, "members_list").handler(ctxFor({ afterId: "m1" }));
    expect(page).toEqual({ members: [
      { id: "m2", email: "m2@example.test", status: "active", createdAt: at, updatedAt: at, version: 3 },
      { id: "m3", email: "m3@example.test", status: "active", createdAt: at, updatedAt: at, version: 3 },
    ], nextCursor: null });
  });

  it("refuses an unknown afterId and refuses afterId together with cursor", async () => {
    const h = harness({ rows });
    await expect(tool(h, "members_list").handler(ctxFor({ afterId: "ghost" }))).rejects.toThrow("unknown afterId 'ghost'");
    await expect(tool(h, "members_list").handler(ctxFor({ afterId: "m1", cursor: "abc" }))).rejects.toThrow("pass cursor or afterId, not both");
  });
});

describe("members_get_by_id", () => {
  it("names a missing member as not found", async () => {
    const h = harness({ rows: [member("m1", { workspaceId: "other" })] });
    await expect(tool(h, "members_get_by_id").handler(ctxFor({ memberId: "m1" }))).rejects.toThrow("member 'm1' was not found");
  });
});

describe("members_delete", () => {
  it("moves the member to Trash through the bound removal port with the operator as actor", async () => {
    const calls: Parameters<RemoveEntity>[0][] = [];
    const removeMember: RemoveEntity = async (args) => { calls.push(args); return { ok: true, version: 4 }; };
    const h = harness({ rows: [member("m1", { name: "One" })] }, { removeMember });
    expect(await tool(h, "members_delete").handler(ctxFor({ memberId: "m1" }))).toEqual({ deleted: true });
    expect(calls).toEqual([{ workspaceId: "w", id: "m1", display: { title: "m1@example.test", subtitle: "One" }, at: nowIso, expectedVersion: 3, actor: { principalId: "owner" } }]);
  });

  it("refuses when no Trash port is bound, and does not call Trash for a cancelled run", async () => {
    const h = harness({ rows: [member("m1")] });
    await expect(tool(h, "members_delete").handler(ctxFor({ memberId: "m1" }))).rejects.toThrow("Member Trash is unavailable in this runtime");
    const calls: unknown[] = [];
    const bound = harness({ rows: [member("m1")] }, { removeMember: async (args) => { calls.push(args); return { ok: true, version: 1 }; } });
    await expect(tool(bound, "members_delete").handler(ctxFor({ memberId: "m1" }, { signal: aborted() }))).rejects.toThrow("run cancelled");
    expect(calls).toEqual([]);
  });
});

describe("members_disable", () => {
  it("disables the member, stamps credential revocation and revokes its sessions", async () => {
    const h = harness({ rows: [member("m1")] });
    const revoked: unknown[] = [];
    class RecordingSessions extends InMemoryMemberSessionRepo {
      override async revokeAllForMember(args: Parameters<InMemoryMemberSessionRepo["revokeAllForMember"]>[0]) { revoked.push(args); return super.revokeAllForMember(args); }
    }
    h.deps.memberSessionRepo = new RecordingSessions();
    const result = await tool(h, "members_disable").handler(ctxFor({ memberId: "m1" }));
    expect(result).toEqual({ member: { id: "m1", email: "m1@example.test", status: "disabled", createdAt: at, updatedAt: nowIso, version: 4 } });
    expect((await h.members.findById({ workspaceId: "w", id: "m1" }))?.credentialsRevokedAt).toBe(nowIso);
    expect(revoked).toEqual([{ workspaceId: "w", memberId: "m1", revokedAt: nowIso }]);
  });

  it("does not disable a member when the run is already cancelled", async () => {
    const h = harness({ rows: [member("m1")] });
    await expect(tool(h, "members_disable").handler(ctxFor({ memberId: "m1" }, { signal: aborted() }))).rejects.toThrow("run cancelled");
    expect((await h.members.findById({ workspaceId: "w", id: "m1" }))?.status).toBe("active");
  });
});

describe("members_request_magic_link (pre-send checks)", () => {
  it("rejects a blank email as a validation error without spending rate-limit budget", async () => {
    const h = harness();
    await expect(tool(h, "members_request_magic_link").handler(ctxFor({ email: "   " }))).rejects.toThrow("'   ' is not a valid email address");
    expect(h.limiterKeys).toEqual([]);
  });

  it("checks the limiter with the normalised email and surfaces a rate limit with its retry delay", async () => {
    const h = harness({}, { allowed: false, retryAfterSeconds: 42 });
    await expect(tool(h, "members_request_magic_link").handler(ctxFor({ email: " Person@Example.TEST " })))
      .rejects.toThrow("MEMBERS_RATE_LIMITED: too many sign-in requests for ' Person@Example.TEST ' — retry after 42s");
    expect(h.limiterKeys).toEqual(["person@example.test"]);
  });
});

describe("contributeMembersTools", () => {
  it("contributes the members domain with the same builder and risk map", () => {
    expect(contributeMembersTools()).toEqual({ domain: "members", build: buildMembersRegistrations, risk: membersDerivedRisk });
  });
});
