import { expect, it } from "vitest";
import { createContentCapabilityCard } from "../capability-card.js";

it("binds the host's permission, tool and admin screen into every pointer of the Content card", () => {
  const card = createContentCapabilityCard({ host: { permission: "p.read", inspectTool: "t.inspect", adminHref: "/a/posts" } });
  expect(card.id).toBe("content");
  expect(card.permissions).toEqual(["p.read"]);
  expect(card.pointers).toEqual([
    { label: "Inspect content", tool: "t.inspect", permissions: ["p.read"] },
    { label: "Content admin", href: "/a/posts", permissions: ["p.read"] },
  ]);
  expect(card.workflows).toEqual([]);
});
