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

test("looks past unrelated groups and labels an ungrouped section for the host locale", () => {
  const copy = {
    fallbackLocale: "en", defaultGroupLabel: "Home", unknownSectionPrefix: ({ locale }: { locale: string }) => `${locale} missing`,
    unknownSectionLabel: "Unknown section", comingSoonDescription: ({ label, locale }: { label: string; locale: string }) => `${locale}: ${label} soon`,
    comingSoonLabel: ({ label }: { label: string }) => `${label} pending`,
  };
  const navGroups = [
    { label: "Settings", items: [{ id: "different", label: "Configuration", href: "/configuration" }] },
    { items: [{ id: "library", label: "Library", href: "/library" }] },
  ];
  const props = { copy, navGroups, useAdminLocaleHook: () => "es", translateNavLabel: ({ key, locale }: { key: string; locale: string }) => `${key}/${locale}` };
  const view = render(<Placeholder {...props} sectionId="library" note="The folder view is separate." agentHandle="library-placeholder" />);
  expect(view.getByText("Home/es")).toBeVisible();
  expect(view.getByRole("heading", { name: "Library/es" })).toBeVisible();
  expect(view.getByText("es: Library/es soon")).toBeVisible();
  expect(view.getByText("The folder view is separate.")).toBeVisible();
  expect(view.container.querySelector('[data-agent-role="status"]')).toHaveAttribute("data-agent-label", "Library/es pending");
  expect(findNavGroupLabel({ sectionId: "missing", navGroups, copy })).toBe("Home");

  view.rerender(<Placeholder {...props} sectionId="typo" agentHandle="missing-section" />);
  expect(view.queryByRole("heading")).toBeNull();
  expect(view.getByText("es missing: typo")).toHaveAttribute("data-agent-label", "Unknown section");
  view.rerender(<Placeholder {...props} sectionId="typo" />);
  expect(view.getByText("es missing: typo")).not.toHaveAttribute("data-agent-label");
});
