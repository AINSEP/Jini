import { expect, it } from "vitest";
import { resolveHostReadRefs } from "@jini-ai/core";
import { capabilityCard } from "../capability-card.js";

it("every pointer is gated by a permission the card itself declares", () => {
  expect(capabilityCard.permissions).toEqual(["member.manage"]);
  for (const pointer of capabilityCard.pointers) {
    expect(pointer.permissions.length).toBeGreaterThan(0);
    for (const permission of pointer.permissions) expect(capabilityCard.permissions).toContain(permission);
  }
});

it("the inspect pointer names no host tool id until the host vocabulary resolves it", () => {
  const entities: unknown[] = [];
  const resolved = resolveHostReadRefs({ value: capabilityCard }, { hostReads: { readRef: ({ entity }) => { entities.push(entity); return `host_read_${entity}`; } } });
  expect(resolved.pointers[0]).toEqual({ label: "Inspect members", tool: "host_read_member", permissions: ["member.manage"] });
  expect(entities).toEqual(["member"]);
  expect(JSON.stringify(capabilityCard)).not.toMatch(/members_get_by_id|members_list/);
});

it("the admin pointer is an in-app admin path and the card keeps member and admin sessions apart", () => {
  expect(capabilityCard.pointers[1]).toEqual({ label: "Members admin", href: "/admin/members", permissions: ["member.manage"] });
  expect(capabilityCard.id).toBe("members");
  expect(capabilityCard.explanation).toContain("never infer member access from an admin role");
});
