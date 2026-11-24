import { expect, it } from "vitest";
import { createFormsCapabilityCard } from "../capability-card.js";

it("binds the host's permission, tool and admin screen into every pointer of the Forms card", () => {
  const card = createFormsCapabilityCard({ host: { permission: "p.manage", inspectTool: "t.form", adminHref: "/a/forms" } });
  expect(card.id).toBe("forms");
  expect(card.permissions).toEqual(["p.manage"]);
  expect(card.pointers).toEqual([
    { label: "Inspect forms", tool: "t.form", permissions: ["p.manage"] },
    { label: "Forms admin", href: "/a/forms", permissions: ["p.manage"] },
  ]);
});
