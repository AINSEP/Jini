import { describe, expect, it } from "vitest";

import type { RemoveEntity } from "@jini-ai/core/contracts/site/plugins-host";
import { InMemoryMemberRepo } from "../repo.memory.js";
import { trashMember } from "../trash-member.js";
import { MemberConflictError, MemberNotFoundError, MemberValidationError, type MemberRecord } from "../types.js";

/**
 * @file `trashMember` hands an existing member to the injected Trash port with its display, version
 * and actor, and translates every port outcome into the member error vocabulary.
 */
const member: MemberRecord = {
  id: "m1", workspaceId: "w1", email: "a@example.test", name: "Ada", status: "active",
  createdAt: "t0", updatedAt: "t0", version: 4,
};
const actor = { principalId: "owner-1" };
const clock = { nowIso: () => "2026-05-01T00:00:00.000Z" };

function removeReturning(result: Awaited<ReturnType<RemoveEntity>>) {
  const calls: Array<Parameters<RemoveEntity>[0]> = [];
  const remove: RemoveEntity = async (required) => { calls.push(required); return result; };
  return { remove, calls };
}

const members = (rows: MemberRecord[] = [member]) => new InMemoryMemberRepo({}, { initialRows: rows });

describe("trashMember", () => {
  it("passes the member's display, version, time and actor to the Trash port", async () => {
    const { remove, calls } = removeReturning({ ok: true, version: 5 });
    expect(await trashMember({ workspaceId: "w1", memberId: "m1", actor }, { members: members(), remove, clock })).toEqual({ deleted: true });
    expect(calls).toEqual([{
      workspaceId: "w1", id: "m1", display: { title: "a@example.test", subtitle: "Ada" },
      at: "2026-05-01T00:00:00.000Z", expectedVersion: 4, actor,
    }]);
  });

  it("sends a null subtitle for a member without a name", async () => {
    const { remove, calls } = removeReturning({ ok: true, version: 5 });
    await trashMember({ workspaceId: "w1", memberId: "m1", actor }, { members: members([{ ...member, name: undefined }]), remove, clock });
    expect(calls[0]?.display).toEqual({ title: "a@example.test", subtitle: null });
  });

  it("refuses when the runtime has no Trash port", async () => {
    await expect(trashMember({ workspaceId: "w1", memberId: "m1", actor }, { members: members(), clock }))
      .rejects.toThrow(new MemberValidationError("Member Trash is unavailable in this runtime"));
  });

  it("reports a missing member without calling the port", async () => {
    const { remove, calls } = removeReturning({ ok: true, version: 1 });
    const err = await trashMember({ workspaceId: "w2", memberId: "m1", actor }, { members: members(), remove, clock }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MemberNotFoundError);
    expect((err as Error).message).toBe("member 'm1' was not found");
    expect(calls).toEqual([]);
  });

  it("maps the port's not-found, version-changed and blocked outcomes", async () => {
    const notFound = trashMember({ workspaceId: "w1", memberId: "m1", actor }, { members: members(), remove: removeReturning({ ok: false, reason: "not-found" }).remove, clock });
    await expect(notFound).rejects.toThrow(new MemberNotFoundError("member 'm1' was not found"));
    const stale = await trashMember({ workspaceId: "w1", memberId: "m1", actor }, { members: members(), remove: removeReturning({ ok: false, reason: "version-changed" }).remove, clock }).catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(MemberConflictError);
    expect((stale as Error).message).toBe("Member changed; read it again before deleting");
    const blocked = trashMember({ workspaceId: "w1", memberId: "m1", actor }, { members: members(), remove: removeReturning({ ok: false, reason: "blocked", code: "x", count: 1 }).remove, clock });
    await expect(blocked).rejects.toThrow("Member Trash unexpectedly reported a blocker");
  });
});
