import { expect, it, vi } from "vitest";
import type { BeforeSaveFilter, DefinedPlugin, PluginSdk } from "@jini-ai/core/contracts/plugin-sdk";
import { createWordCountPlugin } from "../plugin.js";

it("setup attaches once to the injected hook and counts the whole draft body", async () => {
  let filter: BeforeSaveFilter | undefined;
  const addFilter = vi.fn((hook: string, callback: BeforeSaveFilter) => { expect(hook).toBe("injected.before-save"); filter = callback; });
  const definePlugin = vi.fn((definition: DefinedPlugin["definition"]) => ({ definition }));
  const plugin = createWordCountPlugin({ definePlugin, beforeSaveHook: "injected.before-save" });
  await plugin.definition.setup({ addFilter } as unknown as PluginSdk);
  expect(definePlugin).toHaveBeenCalledTimes(1);
  expect(addFilter).toHaveBeenCalledTimes(1);
  if (!filter) throw new Error("missing filter");
  const draft = { workspaceId: "w", ext: {}, bodyJson: { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "first two" }] }, { type: "paragraph", content: [{ type: "text", text: "last three words" }] },
  ] } };
  expect(await filter(draft, { workspaceId: "w", pluginId: "count" })).toEqual({ count: 5 });
  // A draft with no body at all counts zero words instead of failing the save.
  expect(await filter({ workspaceId: "w", ext: {} }, { workspaceId: "w", pluginId: "count" })).toEqual({ count: 0 });
});
