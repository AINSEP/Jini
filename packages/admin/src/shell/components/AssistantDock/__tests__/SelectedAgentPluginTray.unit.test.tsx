// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithAdminKit as render } from "../../../../react/__tests__/render-with-admin-kit.js";
import { SelectedAgentPluginTray, type SelectedAgentPluginChip } from "../SelectedAgentPluginTray.js";

/** The host injects its chat translator; this one interpolates `{name}` the way the real one does. */
const useTHook = () => (key: string, vars: Record<string, string | number> = {}) =>
  key.replace(/\{(\w+)\}/g, (_match, name: string) => String(vars[name] ?? ""));

/**
 * @file First dedicated test file for `SelectedAgentPluginTray.tsx` (0% before this pass).
 * `composer-slash-plugin-pin.unit.test.tsx` proves the `pluginRefIds` state transition this
 * component renders, but deliberately mounts a plain-text probe instead of this component (its own
 * comment: "already covered by SelectedAgentPluginTray's own tests" — no such file existed until
 * now, so the chip-rendering/remove-interaction path was actually untested). Covers the empty
 * early-return, the chip render (label, icon, title tooltip), and the remove interaction.
 */

const ONE_CHIP: readonly SelectedAgentPluginChip[] = [{ pluginRefId: "ui-ux-design", label: "UI/UX Design (Agent Plugin)" }];

describe("SelectedAgentPluginTray", () => {
  it("renders nothing when there are no pinned chips", () => {
    const { container } = render(<SelectedAgentPluginTray useTHook={useTHook} chips={[]} onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one chip per pinned plugin, showing its exact composer-row label", () => {
    render(<SelectedAgentPluginTray useTHook={useTHook} chips={ONE_CHIP} onRemove={vi.fn()} />);

    expect(screen.getByText("UI/UX Design (Agent Plugin)")).toBeInTheDocument();
    expect(screen.getByTitle("UI/UX Design (Agent Plugin)")).toBeInTheDocument();
  });

  it("renders one chip and remove button per pinned plugin, in order", () => {
    const chips: SelectedAgentPluginChip[] = [
      { pluginRefId: "ui-ux-design", label: "UI/UX Design (Agent Plugin)" },
      { pluginRefId: "copy-editor", label: "Copy Editor (Agent Plugin)" },
    ];
    render(<SelectedAgentPluginTray useTHook={useTHook} chips={chips} onRemove={vi.fn()} />);

    const removeButtons = screen.getAllByRole("button");
    expect(removeButtons).toHaveLength(2);
    expect(removeButtons[0]).toHaveAccessibleName("Remove UI/UX Design (Agent Plugin)");
    expect(removeButtons[1]).toHaveAccessibleName("Remove Copy Editor (Agent Plugin)");
  });

  it("calls onRemove with exactly the clicked chip's pluginRefId", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const chips: SelectedAgentPluginChip[] = [
      { pluginRefId: "ui-ux-design", label: "UI/UX Design (Agent Plugin)" },
      { pluginRefId: "copy-editor", label: "Copy Editor (Agent Plugin)" },
    ];
    render(<SelectedAgentPluginTray useTHook={useTHook} chips={chips} onRemove={onRemove} />);

    await user.click(screen.getByRole("button", { name: "Remove Copy Editor (Agent Plugin)" }));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("copy-editor");
  });
});
