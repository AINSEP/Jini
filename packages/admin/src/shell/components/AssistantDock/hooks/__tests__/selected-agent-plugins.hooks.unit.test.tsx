// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { projectComposerCapabilities } from "../../../../../screens/plugins/composer-capabilities.js";
import { useSelectedAgentPlugins, useSelectedPluginChips } from "../selected-agent-plugins.hooks.js";

it("pins each ref once in selection order and keeps a chip when the catalog loses the ref", async () => {
  const entry = { groupId: "plugins", groupLabel: "Plugins", pluginRefId: "report", item: { id: "report-command", label: "Weekly report" } };
  const full = await projectComposerCapabilities({ sources: [{ id: "host", list: async () => [entry] }] });
  const empty = await projectComposerCapabilities({ sources: [] });
  const { result, rerender } = renderHook((projection) => {
    const selection = useSelectedAgentPlugins();
    return { ...selection, chips: useSelectedPluginChips(selection.selectedPluginRefIds, projection) };
  }, { initialProps: full });
  expect(result.current.chips).toEqual([]);
  act(() => {
    result.current.addPluginRef("report");
    result.current.addPluginRef("old-plugin");
    result.current.addPluginRef("report");
  });
  expect(result.current.chips).toEqual([
    { pluginRefId: "report", label: "Weekly report" },
    { pluginRefId: "old-plugin", label: "old-plugin" },
  ]);
  rerender(empty);
  expect(result.current.chips).toEqual([
    { pluginRefId: "report", label: "report" },
    { pluginRefId: "old-plugin", label: "old-plugin" },
  ]);
  act(() => result.current.removePluginRef("report"));
  act(() => result.current.removePluginRef("not-pinned"));
  expect(result.current.selectedPluginRefIds).toEqual(["old-plugin"]);
  expect(result.current.chips).toEqual([{ pluginRefId: "old-plugin", label: "old-plugin" }]);
});
