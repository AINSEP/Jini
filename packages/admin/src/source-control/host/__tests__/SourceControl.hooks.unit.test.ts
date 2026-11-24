import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigateSourceControlTab } from "../SourceControl.hooks.js";

const navigate = vi.fn();

/** Characterization: the Source control panel keeps its selected tab in the deep link, replacing
 *  the history entry rather than stacking one per tab click. */
describe("navigateSourceControlTab", () => {
  beforeEach(() => { navigate.mockClear(); });

  it("writes the tab into the source-control route with replace", () => {
    navigateSourceControlTab({ nextTabId: "providers", navigate });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ routePath: "/source-control?tab=providers" }, { replace: true });
  });
});
