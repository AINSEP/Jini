// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import { ChevronIcon, DocumentIcon, EyeIcon, InstalledIcon, LockIcon, MarketplaceIcon, PackageIcon, PaletteIcon, PlugIcon, RocketIcon, ShieldCheckIcon, TrashIcon, UploadIcon } from "../agent-plugins-visuals.js";
import { SkillChevronIcon } from "../../skills/skills-visuals.js";

afterEach(cleanup);

it.each([["agent plugin", ChevronIcon], ["skill", SkillChevronIcon]] as const)(
  "the %s row chevron carries the package-prefixed class a host styles its rotation by",
  (_name, Chevron) => {
    const view = renderWithAdminKit(<Chevron />);
    expect(view.container.querySelector(".jini-agent-plugin-chevron-glyph")).not.toBeNull();
  },
);

it("draws the document glyph's page outline from the shared compact path", () => {
  const view = renderWithAdminKit(<DocumentIcon />);
  const paths = [...view.container.querySelectorAll("svg path")].map((path) => path.getAttribute("d"));
  expect(paths).toEqual(["M6.5 3.5h7.6l3.9 3.9v13.1H6.5z", "M14 3.5v4h4", "M9.3 12.2h5.4M9.3 15.6h5.4"]);
});

it.each([
  ["installed", InstalledIcon, "package-check", 16],
  ["marketplace", MarketplaceIcon, "storefront", 16],
  ["package", PackageIcon, "package-outline", 18],
  ["trash", TrashIcon, "trash-compact", 16],
] as const)("%s delegates the right decorative glyph and size to the host kit", (_name, Icon, glyph, defaultSize) => {
  const view = renderWithAdminKit(<><Icon /><Icon size={30} /></>);
  expect([...view.container.querySelectorAll("svg")].map((svg) => [
    svg.getAttribute("data-icon"), svg.getAttribute("width"), svg.getAttribute("aria-hidden"),
  ])).toEqual([[glyph, String(defaultSize), "true"], [glyph, "30", "true"]]);
});

it.each([
  ["upload", UploadIcon, 16], ["shield", ShieldCheckIcon, 18], ["rocket", RocketIcon, 18],
  ["palette", PaletteIcon, 18], ["plug", PlugIcon, 18], ["eye", EyeIcon, 16], ["lock", LockIcon, 16],
] as const)("%s emits decorative artwork at the default and caller-selected sizes", (_name, Icon, defaultSize) => {
  const view = renderWithAdminKit(<><Icon /><Icon size={29} /></>);
  expect([...view.container.querySelectorAll("svg")].map((svg) => [
    svg.getAttribute("width"), svg.getAttribute("height"), svg.getAttribute("aria-hidden"),
  ])).toEqual([[String(defaultSize), String(defaultSize), "true"], ["29", "29", "true"]]);
});
