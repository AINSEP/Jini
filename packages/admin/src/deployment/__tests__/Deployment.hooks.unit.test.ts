import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigateDeploymentTab } from "../Deployment.hooks.js";

const navigate = vi.fn();

/** Characterization: the Deployment panel keeps its selected tab in the deep link, replacing the
 *  history entry rather than stacking one per tab click. */
describe("navigateDeploymentTab", () => {
  beforeEach(() => { navigate.mockClear(); });

  it("writes the tab into the deployment route with replace", () => {
    navigateDeploymentTab({ nextTabId: "history", navigate });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ routePath: "/deployment?tab=history" }, { replace: true });
  });
});
