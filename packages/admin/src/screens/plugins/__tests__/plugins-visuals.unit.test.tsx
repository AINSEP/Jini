// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import { AgentPluginMaturity } from "../AgentPluginMaturity.js";
import { PluginChevronIcon, PluginPackageIcon, PluginTrashIcon } from "../plugins-visuals.js";

afterEach(cleanup);

it.each([["plugin package", PluginPackageIcon], ["plugin trash", PluginTrashIcon], ["plugin chevron", PluginChevronIcon]] as const)(
  "%s draws a decorative kit icon at the requested size",
  (_name, Glyph) => {
    const view = renderWithAdminKit(<Glyph size={31} />);
    const svg = view.container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("31");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  },
);

it("the chevron carries the package-prefixed class a host styles its rotation by", () => {
  expect(renderWithAdminKit(<PluginChevronIcon />).container.querySelector(".jini-plugin-chevron-glyph")).not.toBeNull();
});

it("the maturity tag renders nothing without a maturity and a labelled tip with one", () => {
  const t = (key: string) => key;
  expect(renderWithAdminKit(<AgentPluginMaturity maturity={undefined} t={t} />).container.querySelector(".jini-agent-plugin-maturity")).toBeNull();
  const tagged = renderWithAdminKit(<AgentPluginMaturity maturity="untested" t={t} />);
  expect(tagged.container.querySelector(".jini-agent-plugin-maturity [title='Not yet tested end to end. It may not work.']")).not.toBeNull();
});
