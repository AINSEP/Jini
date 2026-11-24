// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import { ChevronIcon, DocumentIcon } from "../agent-plugins-visuals.js";
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
