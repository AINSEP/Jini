import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Placeholder, findNavGroupLabel } from "../Placeholder.js";

afterEach(cleanup);

test("each host supplies its own nav groups and copy", () => {
  const copy = { fallbackLocale: "en", defaultGroupLabel: "Home", unknownSectionPrefix: () => "Unknown", unknownSectionLabel: "Unknown section", comingSoonDescription: ({ label }: { label: string; locale: string }) => `${label} soon`, comingSoonLabel: ({ label }: { label: string }) => `${label} pending` };
  const a = [{ label: "Alpha", items: [{ id: "same", label: "First", href: "/same" }] }];
  const b = [{ label: "Beta", items: [{ id: "same", label: "Second", href: "/same" }] }];
  expect(findNavGroupLabel({ sectionId: "same", navGroups: a, copy })).toBe("Alpha");
  expect(findNavGroupLabel({ sectionId: "same", navGroups: b, copy })).toBe("Beta");
  const view = render(<Placeholder sectionId="same" navGroups={a} copy={copy} useAdminLocaleHook={() => "en"} translateNavLabel={({ key }) => key} />);
  expect(view.getByRole("heading").textContent).toBe("First");
  view.rerender(<Placeholder sectionId="same" navGroups={b} copy={copy} useAdminLocaleHook={() => "en"} translateNavLabel={({ key }) => key} />);
  expect(view.getByRole("heading").textContent).toBe("Second");
});
