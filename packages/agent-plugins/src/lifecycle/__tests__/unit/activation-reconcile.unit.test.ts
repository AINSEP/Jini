import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentPluginLifecycle } from "../../index.js";
import { ports } from "../test-support.js";

test("canonical reads, face comparison and writes share the existing activation queue", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "activation-reconcile-"));
  const api = createAgentPluginLifecycle(ports);
  const target = { workspaceRoot: root, pluginId: "face", actor: "provider" };
  try {
    await api.setAgentPluginActivation({ ...target, enabled: false });
    let enter!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const release = new Promise<void>(resolve => { resume = resolve; });
    const first = api.reconcileAgentPluginActivation({ ...target, resolveEnabled: async () => { enter(); await release; return true; } });
    await entered;
    let read = false;
    let canonical = true;
    const last = api.reconcileAgentPluginActivation({ ...target, resolveEnabled: async () => { read = true; return canonical; } });
    await Promise.resolve();
    expect(read).toBe(false);
    canonical = false;
    resume();
    expect(await first).toBe(true);
    expect(await last).toBe(true);
    expect((await api.readAgentPluginActivations({ workspaceRoot: root })).plugins.face?.enabled).toBe(false);
    expect(await api.reconcileAgentPluginActivation({ ...target, resolveEnabled: async () => false })).toBe(false);
    await expect(api.reconcileAgentPluginActivation({ ...target, resolveEnabled: async () => { throw new Error("canonical unavailable"); } })).rejects.toThrow("canonical unavailable");
    expect(await api.reconcileAgentPluginActivation({ ...target, resolveEnabled: async () => true })).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
