import { describe, expect, it } from "vitest";
import { toAdminMemberResponse, type AdminMemberSource } from "../members.js";

/** @file The admin member serializer is the chokepoint that keeps session/token-shaped and operator-only fields off the wire. */

const member = {
  id: "member-9", workspaceId: "ws-7", email: "pat@example.com", name: "Pat", status: "active", emailVerifiedAt: "2026-09-11T00:00:00Z",
  createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-12T00:00:00Z", version: 4,
  note: "operator-only", fields: { "ext.demo.x": 1 }, credentialsRevokedAt: "2026-09-12T00:00:00Z", tokenHash: "DO-NOT-EXPOSE",
} as AdminMemberSource;

describe("toAdminMemberResponse", () => {
  it("projects exactly the nine admin fields and nothing else", () => {
    expect(toAdminMemberResponse(member)).toEqual({
      id: "member-9", workspaceId: "ws-7", email: "pat@example.com", name: "Pat", status: "active", emailVerifiedAt: "2026-09-11T00:00:00Z",
      createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-12T00:00:00Z", version: 4,
    });
    expect(Object.keys(toAdminMemberResponse(member)).sort()).toEqual(["createdAt", "email", "emailVerifiedAt", "id", "name", "status", "updatedAt", "version", "workspaceId"]);
  });

  it("keeps an absent name and verification stamp as undefined keys (JSON drops them)", () => {
    const dto = toAdminMemberResponse({ ...member, name: undefined, emailVerifiedAt: undefined });
    expect(dto.name).toBeUndefined();
    expect(dto.emailVerifiedAt).toBeUndefined();
    expect(JSON.parse(JSON.stringify(dto))).toEqual({
      id: "member-9", workspaceId: "ws-7", email: "pat@example.com", status: "active", createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-12T00:00:00Z", version: 4,
    });
  });
});
