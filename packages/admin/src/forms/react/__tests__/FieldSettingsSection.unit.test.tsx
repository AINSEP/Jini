import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdminFormField } from "../../models.js";
import { settingsFormFromField, type FieldSettingsForm } from "../../field-settings.js";
import type { FieldAttributesDialogController } from "../hooks/use-field-attributes-dialog.hooks.js";
import { FieldSettingsSection } from "../components/FieldSettingsSection.js";

/**
 * @file `FieldSettingsSection` in isolation: which rows each field type renders (the type's
 * registry kind decides, via `fieldSettingsFor`) and that each control reaches the dialog
 * controller. The controller is a typed fake so every assertion names the exact call.
 */

const t = (key: string) => key;

function field(type: string, extra: Partial<AdminFormField> = {}): AdminFormField {
  return { id: "f", label: "F", type, required: false, ...extra } as AdminFormField;
}

function fakeController(settings: FieldSettingsForm): FieldAttributesDialogController {
  return {
    className: "", setClassName: vi.fn(), rows: [], updateRow: vi.fn(), removeRow: vi.fn(), addRow: vi.fn(),
    settings, setSettings: vi.fn(), toggleDefaultChoice: vi.fn(), toggleAccept: vi.fn(), updateOption: vi.fn(),
    addOption: vi.fn(), removeOption: vi.fn(), moveOption: vi.fn(), error: null, submit: vi.fn(),
  };
}

function renderFor(f: AdminFormField, patch: Partial<FieldSettingsForm> = {}) {
  const controller = fakeController({ ...settingsFormFromField({ field: f }), ...patch });
  const view = render(<FieldSettingsSection field={f} controller={controller} t={t} />);
  return { controller, ...view };
}

const choiceField = () => field("select", { options: [{ value: "a", label: "A" }, { value: "b", label: "" }, { value: "", label: "Blank" }] });

describe("FieldSettingsSection rows by type", () => {
  it("renders placeholder, help text, a text default, length and pattern for a short-text field", () => {
    const { container } = renderFor(field("text"));
    expect(container.querySelector("#field-settings-placeholder")).not.toBeNull();
    expect(container.querySelector("#field-settings-help")).not.toBeNull();
    expect(container.querySelector("#field-settings-default")?.getAttribute("type")).toBe("text");
    expect(screen.getByLabelText("Min length")).not.toBeNull();
    expect(container.querySelector("#field-settings-pattern")).not.toBeNull();
    expect(screen.queryByLabelText("Step")).toBeNull();
  });

  it("gives the first rendered input the autofocus marker (placeholder for text)", () => {
    const { container } = renderFor(field("text"));
    expect(container.querySelector("[data-jini-autofocus]")?.id).toBe("field-settings-placeholder");
  });

  it("renders number bounds with a step and a compact number default for a number field", () => {
    const { container } = renderFor(field("number"));
    expect(screen.getByLabelText("Min").getAttribute("type")).toBe("number");
    expect(screen.getByLabelText("Min").className).toBe("field-settings-num");
    expect(screen.getByLabelText("Step")).not.toBeNull();
    const def = container.querySelector("#field-settings-default");
    expect(def?.getAttribute("type")).toBe("number");
    expect(def?.className).toBe("field-settings-compact");
  });

  it("renders date bounds without a step and a date-typed default for a date field", () => {
    const { container } = renderFor(field("date"));
    expect(screen.getByLabelText("Max").getAttribute("type")).toBe("date");
    expect(screen.getByLabelText("Max").className).toBe("field-settings-compact");
    expect(screen.queryByLabelText("Step")).toBeNull();
    expect(container.querySelector("#field-settings-default")?.getAttribute("type")).toBe("date");
  });

  it("renders the option list and a default select (labels falling back to values) for a dropdown", () => {
    const { container } = renderFor(choiceField());
    expect(screen.getByRole("group", { name: "Options" })).not.toBeNull();
    const select = container.querySelector("select#field-settings-default")!;
    expect([...select.querySelectorAll("option")].map((o) => [o.value, o.textContent])).toEqual([["", "None"], ["a", "A"], ["b", "b"]]);
    expect(container.querySelectorAll(".field-option-default")).toHaveLength(0);
  });

  it("renders a per-option default checkbox and no default select for a multi-select", () => {
    const { container } = renderFor(field("multi-select", { options: [{ value: "a", label: "A" }] }));
    expect(container.querySelectorAll(".field-option-default")).toHaveLength(1);
    expect(container.querySelector("#field-settings-default")).toBeNull();
  });

  it("renders a checked-by-default box for a checkbox field", () => {
    renderFor(field("checkbox"));
    expect(screen.getByRole("checkbox", { name: "Checked by default" })).not.toBeNull();
  });

  it("renders the accepted-file checks and max size for a file field, focusing help text", () => {
    const { container } = renderFor(field("file"), { accept: ["image/*"] });
    expect((screen.getByRole("checkbox", { name: "Images" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Videos" }) as HTMLInputElement).checked).toBe(false);
    expect(container.querySelector("#field-settings-max-size")).not.toBeNull();
    expect(container.querySelector("[data-jini-autofocus]")?.id).toBe("field-settings-help");
  });

  it("renders only the help-text row for an unknown type", () => {
    const { container } = renderFor(field("legacy-thing"));
    expect(container.querySelectorAll(".field-settings-row")).toHaveLength(1);
    expect(container.querySelector("#field-settings-help")).not.toBeNull();
  });

  it("renders neither help text nor placeholder for a hidden field", () => {
    const { container } = renderFor(field("hidden"));
    expect(container.querySelector("#field-settings-help")).toBeNull();
    expect(container.querySelector("#field-settings-placeholder")).toBeNull();
  });
});

describe("FieldSettingsSection wiring", () => {
  it("sends typed text settings to setSettings by key", () => {
    const { controller, container } = renderFor(field("text"));
    fireEvent.change(container.querySelector("#field-settings-placeholder")!, { target: { value: "p" } });
    fireEvent.change(container.querySelector("#field-settings-pattern")!, { target: { value: "[0-9]+" } });
    fireEvent.change(screen.getByLabelText("Max length"), { target: { value: "9" } });
    expect(controller.setSettings).toHaveBeenNthCalledWith(1, { placeholder: "p" });
    expect(controller.setSettings).toHaveBeenNthCalledWith(2, { pattern: "[0-9]+" });
    expect(controller.setSettings).toHaveBeenNthCalledWith(3, { maxLength: "9" });
  });

  it("sends the default checkbox state to setSettings", () => {
    const { controller } = renderFor(field("checkbox"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Checked by default" }));
    expect(controller.setSettings).toHaveBeenCalledWith({ defaultChecked: true });
  });

  it("toggles a single default choice from the default select", () => {
    const { controller, container } = renderFor(choiceField());
    fireEvent.change(container.querySelector("select#field-settings-default")!, { target: { value: "a" } });
    expect(controller.toggleDefaultChoice).toHaveBeenCalledWith("a", true, true);
  });

  it("adds, moves and removes options through the controller", () => {
    const { controller } = renderFor(choiceField());
    fireEvent.click(screen.getByRole("button", { name: "Add option" }));
    fireEvent.click(screen.getByRole("button", { name: "Move option 1 down" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove option 2" }));
    expect(controller.addOption).toHaveBeenCalledTimes(1);
    expect(controller.moveOption).toHaveBeenCalledWith(0, 1);
    expect(controller.removeOption).toHaveBeenCalledWith(1);
  });

  it("toggles an accepted upload type through the controller", () => {
    const { controller } = renderFor(field("file"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Videos" }));
    expect(controller.toggleAccept).toHaveBeenCalledWith("video/*", true);
  });

  it("sends a range step to setSettings", () => {
    const { controller } = renderFor(field("range"));
    fireEvent.change(screen.getByLabelText("Step"), { target: { value: "5" } });
    expect(controller.setSettings).toHaveBeenCalledWith({ step: "5" });
  });
});
