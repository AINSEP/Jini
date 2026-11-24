// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { InfoTipProps } from "../../../react/kit.js";
import { AssistantToggleRow, type AssistantToggleRowProps } from "../AssistantToggleRow.js";

/**
 * @file The toggle row's contract with its host: the injected ⓘ receives the explainer, a
 * translated trigger name and the id the checkbox is described by; the switch variant adds
 * `role="switch"`; and the checkbox reports the NEW checked state, not the old one.
 */

/** Stand-in for the host's tip widget: renders the hidden explainer under `descriptionId`, the
 *  way a real InfoTip does, plus a trigger carrying its accessible name. */
function FakeInfoTip({ label, triggerLabel, descriptionId, agentHandle }: InfoTipProps) {
  return <span data-agent-handle={agentHandle || undefined}>
    <button type="button" aria-label={triggerLabel}>i</button>
    <span id={descriptionId} hidden>{label}</span>
  </span>;
}

const t = (key: string) => (key === "More info: {name}" ? "Más información: {name}" : key);

function renderRow(overrides: Partial<AssistantToggleRowProps> = {}) {
  const onChange = vi.fn();
  const view = render(<AssistantToggleRow label="Full CLI access" info="Lets the assistant run commands."
    checked={false} onChange={onChange} t={t} InfoTip={FakeInfoTip} {...overrides} />);
  return { onChange, ...view };
}

describe("AssistantToggleRow", () => {
  it("labels the checkbox and describes it with the injected tip's explainer", () => {
    renderRow();
    const box = screen.getByRole("checkbox", { name: "Full CLI access" });
    expect(box).toHaveAccessibleDescription("Lets the assistant run commands.");
  });

  it("names the tip trigger through the host translator, with the label substituted", () => {
    renderRow({ label: "Price $& {name}" });
    expect(screen.getByRole("button", { name: "Más información: Price $& {name}" })).toBeInTheDocument();
  });

  it("appends the caller's describedBy ids after the tip's own", () => {
    render(<>
      <p id="owner-note">Only the owner can change this.</p>
      <AssistantToggleRow label="Full CLI access" info="Runs commands." checked={false} onChange={() => {}}
        t={t} InfoTip={FakeInfoTip} describedBy="owner-note" />
    </>);
    expect(screen.getByRole("checkbox")).toHaveAccessibleDescription("Runs commands. Only the owner can change this.");
  });

  it("reports the new checked state on change", () => {
    const { onChange } = renderRow({ checked: false });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("renders a switch only for the switch variant, under jini class names", () => {
    const { container, rerender } = renderRow({ variant: "switch", className: "extra" });
    expect(screen.getByRole("switch", { name: "Full CLI access" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("jini-assistant-toggle", "jini-assistant-toggle--switch", "extra");

    rerender(<AssistantToggleRow label="Full CLI access" info="x" checked onChange={() => {}} t={t} InfoTip={FakeInfoTip} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(container.firstElementChild).not.toHaveClass("jini-assistant-toggle--switch");
  });

  it("keeps the disabled state, spreads input attributes and passes the info handle through", () => {
    const { container } = renderRow({ disabled: true, inputProps: { "data-agent-handle": "row-input" } as AssistantToggleRowProps["inputProps"], infoHandle: "row-info" });
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("checkbox")).toHaveAttribute("data-agent-handle", "row-input");
    expect(container.querySelector('[data-agent-handle="row-info"]')).not.toBeNull();
  });

  it("renders children under the row", () => {
    renderRow({ children: <p>Saving…</p> });
    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });
});
