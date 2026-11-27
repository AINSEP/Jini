// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { DeploymentOverviewSnapshot } from "@jini-ai/core/contracts/site/cms-system-deploy";
import { OverviewTab, type OverviewTabProps } from "../OverviewTab.js";

afterEach(cleanup);
const t = (key: string) => key;
const props: Omit<OverviewTabProps, "useDeploymentOverviewHook"> = {
  staticSiteCapabilities: [{ id: "pages", labelKey: "Published pages", supported: true }],
  fullSiteCapabilities: [], envVarNotes: { OWNER_PASSWORD: "Set a private owner password", PORT: "Uses the default port" },
  unsafeOwnerPasswordVar: "OWNER_PASSWORD", copy: { fullSiteGetLine: "Full server", unsafeOwnerPasswordLabel: "Change the default password" },
  agentHandle, lineIcon: { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
};
const loaded: DeploymentOverviewSnapshot = {
  mode: "production", productionReadinessGate: { applicable: true, passed: true },
  defaultOwnerPasswordUnsafe: true, daemonKnownFailed: true,
  dbPath: "/workspace/example/content.db", uploadsDir: "/workspace/example/uploads",
  envVars: [
    { name: "OWNER_PASSWORD", set: false },
    { name: "PORT", set: false },
    { name: "SITE_KEY", set: true, source: "file" },
    { name: "NEW_KEY", set: true, invalid: true },
    { name: "OTHER", set: true },
  ],
};
function panel(snapshot: DeploymentOverviewSnapshot | undefined, error: string | null) {
  return <OverviewTab {...props} useDeploymentOverviewHook={() => ({ snapshot, error, t })} />;
}

it("keeps path choices available while diagnostics load or fail", () => {
  const { rerender } = render(panel(undefined, null));
  expect(screen.getByText("Loading deployment status…").textContent).toBe("Loading deployment status…");
  expect(screen.getByRole("link", { name: "View Static Site details" }).getAttribute("href")).toBe("/admin/deployment?tab=static-site");
  expect(screen.getByRole("link", { name: "View the Dockerfile" }).getAttribute("href")).toBe("/admin/deployment?tab=dockerfile");

  rerender(panel(undefined, "Could not load this instance"));
  expect(screen.getByText("Could not load this instance").textContent).toBe("Could not load this instance");
  expect(screen.queryByText("Loading deployment status…")).toBeNull();
  expect(screen.queryByRole("heading", { name: "How this instance is running" })).toBeNull();
  expect(screen.getByRole("link", { name: "View the Dockerfile" }).getAttribute("href")).toBe("/admin/deployment?tab=dockerfile");
});

it("associates each diagnostic with its own status and keeps the last snapshot visible after a refresh failure", () => {
  const { rerender } = render(panel(loaded, "Refresh failed"));
  expect(screen.getByText("Refresh failed").textContent).toBe("Refresh failed");
  expect(screen.getByRole("heading", { name: "How this instance is running" }).tagName).toBe("H2");
  const fact = (label: string) => screen.getByText(label).parentElement!;
  const diagnostic = (name: string) => {
    const li = screen.getByText(name).closest("li");
    if (!li) throw new Error(`Missing environment row for ${name}`);
    return within(li);
  };
  expect(fact("Runtime mode").textContent).toBe("Runtime modeProduction");
  expect(fact("Production readiness gate").textContent).toBe("Production readiness gatePassed");
  expect(fact("Owner password").textContent).toBe("Owner passwordChange the default password");
  expect(fact("Agent daemon").textContent).toBe("Agent daemonKnown failure — check server logs.");
  expect(within(fact("Database file")).getByText(loaded.dbPath).getAttribute("translate")).toBe("no");
  expect(within(fact("Uploads folder")).getByText(loaded.uploadsDir).textContent).toBe("/workspace/example/uploads");
  expect(diagnostic("OWNER_PASSWORD").getByText("Not set").classList.contains("status-warning")).toBe(true);
  expect(diagnostic("OWNER_PASSWORD").getByText("Set a private owner password").textContent).toBe("Set a private owner password");
  expect(diagnostic("PORT").getByText("Not set").classList.contains("status-neutral")).toBe(true);
  expect(diagnostic("SITE_KEY").getByText("Set (generated key file)").classList.contains("status-ok")).toBe(true);
  expect(diagnostic("NEW_KEY").getByText("Invalid — the keyring rejects it").classList.contains("status-warning")).toBe(true);
  expect(diagnostic("OTHER").getByText("Set").textContent).toBe("Set");

  rerender(panel({ ...loaded, mode: "local", productionReadinessGate: { applicable: false, passed: false }, defaultOwnerPasswordUnsafe: false, daemonKnownFailed: false }, null));
  expect(screen.queryByText("Refresh failed")).toBeNull();
  expect(fact("Runtime mode").textContent).toBe("Runtime modeLocal");
  expect(fact("Production readiness gate").textContent).toBe("Production readiness gateNot applicable (local mode)");
  expect(fact("Owner password").textContent).toBe("Owner passwordChanged from the default.");
  expect(fact("Agent daemon").textContent).toBe("Agent daemonNo known failure");
});
