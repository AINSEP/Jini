// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { navigateSecurityTab } from "../Security.hooks.js";

/** Characterizes the tab deep link before the move: the selected tab lands in `?tab=` on the
 *  access-tokens route, and switching tabs replaces the history entry instead of pushing one. */
describe("navigateSecurityTab", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("writes the selected tab into the access-tokens deep link", () => {
    navigateSecurityTab({ nextTabId: "site-key" });
    expect(window.location.pathname.endsWith("/access-tokens")).toBe(true);
    expect(window.location.search).toBe("?tab=site-key");
  });

  it("replaces the current history entry rather than pushing a new one", () => {
    const before = window.history.length;
    navigateSecurityTab({ nextTabId: "access-tokens" });
    navigateSecurityTab({ nextTabId: "site-key" });
    expect(window.history.length).toBe(before);
    expect(window.location.search).toBe("?tab=site-key");
  });
});
