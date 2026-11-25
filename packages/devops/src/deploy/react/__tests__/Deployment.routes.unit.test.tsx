// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { resolveActiveTabId } from "@jini-ai/core/text";
import { Deployment, type DeploymentProps } from "../Deployment.js";

test("unknown tabs fall back to overview and every route mounts only its active child", async () => {
  const node = document.createElement("div");
  const root = createRoot(node);
  const calls: string[] = [];
  const props: DeploymentProps = {
    useAdminLocaleHook: () => "en", t: ({ key }) => key, onTabChange: () => {}, TabBar: () => null,
    StaticSiteTab: () => { calls.push("static-site"); return null; }, HistoryTab: () => { calls.push("history"); return null; },
    overview: { useDeploymentOverviewHook: () => { calls.push("overview"); return { snapshot: undefined, error: null, t: key => key }; }, staticSiteCapabilities: [], fullSiteCapabilities: [], envVarNotes: {}, unsafeOwnerPasswordVar: "OWNER_PASSWORD", copy: { fullSiteGetLine: "Full server", unsafeOwnerPasswordLabel: "Change password" }, agentHandle, lineIcon: { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } },
    dockerfile: { useDockerfileSourceHook: () => { calls.push("dockerfile"); return { snapshot: undefined, draft: "", setDraft: () => {}, isDirty: false, error: null, saving: false, saveError: null, saveConflict: null, reloadAfterConflict: async () => {}, saved: false, copied: false, copy: async () => {}, save: async () => {}, t: key => key }; }, download: () => {}, dockerfileLineCountLabel: ({ count }) => String(count), agentHandle, lineIcon: { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } },
    agentHandle, resolveActiveTabId, lineIcon: { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
  };
  for (const [tabId, expected] of [["garbage", "overview"], ["static-site", "static-site"], ["dockerfile", "dockerfile"], ["history", "history"]] as const) {
    calls.length = 0;
    await act(async () => { root.render(<Deployment {...props} tabId={tabId} />); });
    expect(calls).toEqual([expected]);
  }
  await act(async () => { root.unmount(); });
});
