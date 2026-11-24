import { expect, it } from "vitest";
import { createWidgetsCapabilityCard } from "../capability-card.js";

it("binds the host's permission, tools and admin screen into every pointer of the Widgets card", () => {
  const card = createWidgetsCapabilityCard({
    host: { permission: "w.read", inspectInstancesTool: "t.inst", inspectRegionsTool: "t.reg", adminHref: "/a/widgets" },
  });
  expect(card.id).toBe("widgets");
  expect(card.permissions).toEqual(["w.read"]);
  expect(card.pointers).toEqual([
    { label: "Inspect widgets", tool: "t.inst", permissions: ["w.read"] },
    { label: "Inspect regions", tool: "t.reg", permissions: ["w.read"] },
    { label: "Widgets admin", href: "/a/widgets", permissions: ["w.read"] },
  ]);
});
