// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import { AgentPluginMaturity } from "../AgentPluginMaturity.js";
import { PluginChevronIcon, PluginPackageIcon, PluginTrashIcon } from "../plugins-visuals.js";

afterEach(cleanup);

it.each([["plugin package", PluginPackageIcon, 18], ["plugin trash", PluginTrashIcon, 16], ["plugin chevron", PluginChevronIcon, 14]] as const)(
  "%s draws a decorative kit icon at its default and requested size",
  (_name, Glyph, defaultSize) => {
    const view = renderWithAdminKit(<Glyph />);
    expect(view.container.querySelector("svg")).toBeTruthy();
    expect(view.container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    view.rerender(<Glyph size={31} />);
    expect(view.container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(defaultSize).toBeGreaterThan(0);
  },
);

it("the maturity tag renders nothing without a maturity and a labelled tip with one", () => {
  const t = (key: string) => key;
  expect(renderWithAdminKit(<AgentPluginMaturity maturity={undefined} t={t} />).container.textContent).toBe("");
  expect(renderWithAdminKit(<AgentPluginMaturity maturity="untested" t={t} />).container.textContent).toContain("Untested");
});
