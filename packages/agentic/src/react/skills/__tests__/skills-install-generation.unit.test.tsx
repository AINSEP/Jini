import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { SkillInstallPayload } from "@jini-ai/core/contracts/site/skill-install";
import { useSkillInstall } from "../use-skill-install.hooks.js";

test("proposal waits for one locked confirmation and superseded upload reads cannot replace the newest", async () => {
  const node = document.createElement("div");
  const root = createRoot(node);
  const installSkill = vi.fn(async (_payload: SkillInstallPayload) => {});
  const reads: Array<(payload: SkillInstallPayload) => void> = [];
  const prepareSkillUpload = () => new Promise<SkillInstallPayload>(resolve => { reads.push(resolve); });
  let current: ReturnType<typeof useSkillInstall> | undefined;
  function Probe() {
    current = useSkillInstall({ installSkill, prepareSkillUpload, describeFailure: () => { throw new Error("unexpected failure"); } });
    return null;
  }
  await act(async () => { root.render(<Probe />); });
  const controller = () => { if (!current) throw new Error("not mounted"); return current; };
  await act(async () => { controller().propose({ githubUrl: "https://example.com/skill" }); });
  expect(installSkill).not.toHaveBeenCalled();
  await act(async () => { await Promise.all([controller().confirm(), controller().confirm()]); });
  expect(installSkill).toHaveBeenCalledExactlyOnceWith({ githubUrl: "https://example.com/skill" });
  let older: Promise<void> = Promise.resolve();
  let newer: Promise<void> = Promise.resolve();
  await act(async () => { older = controller().proposeFiles([]); newer = controller().proposeFiles([]); });
  await act(async () => { reads[1]?.({ githubUrl: "https://example.com/new" }); await newer; });
  expect(controller().pending).toEqual({ githubUrl: "https://example.com/new" });
  await act(async () => { reads[0]?.({ githubUrl: "https://example.com/old" }); await older; });
  expect(controller().pending).toEqual({ githubUrl: "https://example.com/new" });
  expect(installSkill).toHaveBeenCalledTimes(1);
  await act(async () => { root.unmount(); });
});
