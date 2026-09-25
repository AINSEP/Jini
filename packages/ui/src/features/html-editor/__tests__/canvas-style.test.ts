import { describe, expect, it } from "vitest";

import { buildCanvasStyleConfig, CANVAS_STYLES_PENDING_CLASS } from "../canvas-style.js";

/**
 * @file Regression coverage for the canvas styling config. Two bugs are pinned down here:
 *
 * 1. The editor's canvas loaded no stylesheets at all, so every document was edited against browser
 *    defaults (Times on white) rather than the CSS it actually publishes with.
 * 2. GrapesJS's default `frameStyle` lands in the canvas document's `<body>`, so its
 *    `body { background-color: #fff }` beats a host stylesheet loaded into `<head>` on document
 *    order — a dark theme's near-white text then renders on white.
 *
 * See `canvas-style.ts`'s own file header for how both were confirmed live.
 */
describe("buildCanvasStyleConfig", () => {
  it("passes the host's stylesheet URLs through for GrapesJS to link into the canvas", () => {
    const { styles } = buildCanvasStyleConfig({ stylesheets: ["/theme-assets/basic/css/theme.css"] });
    expect(styles).toEqual(["/theme-assets/basic/css/theme.css"]);
  });

  it("defaults to no stylesheets when the host supplies none", () => {
    expect(buildCanvasStyleConfig({}).styles).toEqual([]);
  });

  it("copies the stylesheet list rather than aliasing the caller's array", () => {
    const stylesheets = ["/a.css"];
    expect(buildCanvasStyleConfig({ stylesheets }).styles).not.toBe(stylesheets);
  });

  it("keeps GrapesJS's white body background when the host supplies no canvas styling", () => {
    expect(buildCanvasStyleConfig({}).frameStyle).toContain("body { background-color: #fff }");
  });

  it("drops the white body background once the host loads its own stylesheet", () => {
    const { frameStyle } = buildCanvasStyleConfig({ stylesheets: ["/theme-assets/basic/css/theme.css"] });
    expect(frameStyle).not.toContain("background-color: #fff");
  });

  it("drops the white body background once the host supplies raw canvas CSS", () => {
    expect(buildCanvasStyleConfig({ css: ":root{--bg:#111}" }).frameStyle).not.toContain("background-color: #fff");
  });

  it("treats an empty stylesheet list as no host styling at all", () => {
    expect(buildCanvasStyleConfig({ stylesheets: [] }).frameStyle).toContain("body { background-color: #fff }");
  });

  it("keeps GrapesJS's scrollbar chrome in every case", () => {
    for (const styling of [{}, { stylesheets: ["/a.css"] }, { css: "body{color:red}" }]) {
      expect(buildCanvasStyleConfig(styling).frameStyle).toContain("* ::-webkit-scrollbar { width: 10px }");
    }
  });

  it("appends the host's raw CSS last, so it wins against everything above it", () => {
    const { frameStyle } = buildCanvasStyleConfig({ stylesheets: ["/a.css"], css: ":root{--bg:#111}" });
    expect(frameStyle.indexOf(":root{--bg:#111}")).toBeGreaterThan(frameStyle.indexOf("::-webkit-scrollbar"));
    expect(frameStyle.trimEnd().endsWith(":root{--bg:#111}")).toBe(true);
  });

  it("always includes a rule that hides the canvas body via the stylesheets-pending class (Bug B, Slice B1)", () => {
    for (const styling of [{}, { stylesheets: ["/a.css"] }, { css: "body{color:red}" }]) {
      expect(buildCanvasStyleConfig(styling).frameStyle).toContain(`.${CANVAS_STYLES_PENDING_CLASS} { visibility: hidden }`);
    }
  });
});
