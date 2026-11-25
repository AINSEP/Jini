import { expect, it } from "vitest";
import { toAdminPresentationResponse } from "../presentation.js";

it("projects only public presentation settings and the supplied theme lists", () => {
  const availableThemes = [{ id: "paper", name: "Paper", tier: "declarative" }] as never;
  const settings = { workspaceId: "ws", activeThemeId: "paper", updatedAt: "now", internalOnly: "secret" };
  const result = toAdminPresentationResponse({
    settings,
    availableThemeIds: ["paper", "ink"],
    availableThemes,
    activeThemeTemplates: ["page-shell.html"],
    activeThemeStaticPageIds: ["about"],
  });
  expect(result).toEqual({
    settings: { workspaceId: "ws", activeThemeId: "paper", updatedAt: "now" },
    availableThemeIds: ["paper", "ink"],
    availableThemes,
    activeThemeTemplates: ["page-shell.html"],
    activeThemeStaticPageIds: ["about"],
  });
  expect(Object.keys(result.settings)).toEqual(["workspaceId", "activeThemeId", "updatedAt"]);
  expect(JSON.stringify(result)).not.toContain("secret");
});
