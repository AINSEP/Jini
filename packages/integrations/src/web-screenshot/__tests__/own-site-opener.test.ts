import { ToolInputError } from "@jini-ai/core";
import { expect, test } from "vitest";

import { createOwnSiteOpener, type RenderableTheme } from "../own-site-opener.js";

/**
 * @file The own-site opener behind `web_screenshot_page`'s `themeId`: an unknown or broken theme is
 * refused BEFORE a server is booted (the site render would otherwise silently fall back to the
 * default theme and the agent would compare the wrong picture), and a good one is handed to the
 * loopback server as a render override. The theme roster is read per call because discovery
 * mutates it in place. Every capture is built without the site's cookie consent layer
 * (`consentAudit`), so the agent judges the page itself, not the banner over it (2026-10-27).
 */

function theme(id: string, status: "valid" | "invalid" = "valid"): RenderableTheme {
  return { manifest: { id }, status };
}

function harness(themes: RenderableTheme[]) {
  const opened: Array<{ themeId?: string; consentAudit?: true }> = [];
  const open = createOwnSiteOpener({
    themes,
    openLoopback: async (_required, optional) => { opened.push(optional); return { origin: "http://127.0.0.1:1", close: async () => {} }; },
  });
  return { open, opened };
}

test("no themeId: the site opens with no theme override (its active theme) and no consent banner", async () => {
  const { open, opened } = harness([theme("starter")]);
  await expect(open()).resolves.toMatchObject({ origin: "http://127.0.0.1:1" });
  expect(opened).toEqual([{ consentAudit: true }]);
});

test("an installed, valid themeId is passed through as the render override, still without the consent banner", async () => {
  const { open, opened } = harness([theme("starter"), theme("luvira-copy")]);
  await open({}, { themeId: "luvira-copy" });
  expect(opened).toEqual([{ themeId: "luvira-copy", consentAudit: true }]);
});

test("an unknown themeId is refused with the installed ids, and nothing is booted", async () => {
  const { open, opened } = harness([theme("starter"), theme("luvira-copy"), theme("broken", "invalid")]);
  const refusal = await open({}, { themeId: "luvira" }).catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(ToolInputError);
  expect((refusal as Error).message).toBe("web_screenshot_page: themeId 'luvira' is not an installed theme. Installed themes: starter, luvira-copy.");
  expect(opened).toEqual([]);
});

test("an unknown themeId reports none when every installed theme is invalid, and nothing is booted", async () => {
  const { open, opened } = harness([theme("broken", "invalid")]);
  const refusal = await open({}, { themeId: "missing" }).catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(ToolInputError);
  expect((refusal as Error).message).toBe("web_screenshot_page: themeId 'missing' is not an installed theme. Installed themes: none.");
  expect(opened).toEqual([]);
});

test("an installed but invalid theme is refused rather than silently rendered as the default theme", async () => {
  const { open, opened } = harness([theme("starter"), theme("broken", "invalid")]);
  await expect(open({}, { themeId: "broken" })).rejects.toThrow(/themeId 'broken' is installed but invalid \(it fails theme validation\), so the site would render a different theme instead/);
  expect(opened).toEqual([]);
});

test("the roster is read at call time, so a theme duplicated after boot is accepted", async () => {
  const themes = [theme("starter")];
  const { open, opened } = harness(themes);
  themes.push(theme("fresh-copy"));
  await open({}, { themeId: "fresh-copy" });
  expect(opened).toEqual([{ themeId: "fresh-copy", consentAudit: true }]);
});
