import { describe, expect, it } from "vitest";
import { defaultAdminTheme } from "../../../core/theme/default.js";
import { buildCanvasStyleConfig } from "../canvas-style.js";

describe("buildCanvasStyleConfig color scheme", () => {
  it("renders the theme variables for the host's resolved dark scheme", () => {
    const { frameStyle } = buildCanvasStyleConfig({ colorScheme: "dark" });
    expect(frameStyle).toContain(":root{color-scheme:dark;");
    expect(frameStyle).toContain(`--jini-bg:${defaultAdminTheme.dark.bg};`);
  });

  it("falls back to the light scheme when the host resolves none", () => {
    const { frameStyle } = buildCanvasStyleConfig({});
    expect(frameStyle).toContain(":root{color-scheme:light;");
    expect(frameStyle).toContain(`--jini-bg:${defaultAdminTheme.light.bg};`);
  });
});
