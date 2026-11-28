// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NumberStepper, type NumberStepperLabels } from "../NumberStepper.js";
import { useNumberStepper } from "../use-number-stepper.hooks.js";
import type { NumberSetting } from "../use-optimistic-number-setting.hooks.js";

const bounds = { min: 1, max: 5 };
const labels: NumberStepperLabels = { decrease: "Fewer things", increase: "More things", field: "Things", tip: "Each thing costs memory." };

function Harness({ initial, onSave, classNames }: { initial: number; onSave: (next: number) => void; classNames?: Parameters<typeof NumberStepper>[0]["classNames"] }) {
  const [value, setValue] = useState(initial);
  const setting: NumberSetting = { available: true, value, error: null, save: ({ next }) => { if (next === value) return; onSave(next); setValue(next); } };
  return <><span id="things-label">Things</span><NumberStepper setting={setting} bounds={bounds} labels={labels} labelledBy="things-label" hooks={{ useNumberStepper: useNumberStepper }} {...(classNames ? { classNames } : {})} /></>;
}

const field = () => screen.getByRole("spinbutton", { name: "Things" }) as HTMLInputElement;
const more = () => screen.getByRole("button", { name: "More things" }) as HTMLButtonElement;
const fewer = () => screen.getByRole("button", { name: "Fewer things" }) as HTMLButtonElement;

describe("NumberStepper", () => {
  it("is a labelled spinbutton over the injected bounds, with the injected tip on the group and the field", () => {
    const { container } = render(<Harness initial={3} onSave={vi.fn()} />);
    const input = field();
    expect(["role", "aria-valuemin", "aria-valuemax", "aria-valuenow", "inputmode"].map((name) => input.getAttribute(name))).toEqual(["spinbutton", "1", "5", "3", "numeric"]);
    expect(input.value).toBe("3");
    const group = container.querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-labelledby")).toBe("things-label");
    for (const host of [group, input]) {
      expect(host.classList.contains("jini-tooltip")).toBe(true);
      expect(host.getAttribute("data-tooltip")).toBe(labels.tip);
    }
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe(labels.tip);
    expect(group.classList.contains("jini-number-stepper")).toBe(true);
  });

  it("+ steps up and is disabled at the upper limit; − is disabled at the lower limit", () => {
    const onSave = vi.fn();
    render(<Harness initial={4} onSave={onSave} />);
    expect(more().disabled).toBe(false);
    fireEvent.click(more());
    expect(onSave).toHaveBeenLastCalledWith(5);
    expect(field().value).toBe("5");
    expect(more().disabled).toBe(true);
    fireEvent.click(fewer());
    expect(onSave).toHaveBeenLastCalledWith(4);
  });

  it("− is off at the lower limit and + is on", () => {
    render(<Harness initial={1} onSave={vi.fn()} />);
    expect(fewer().disabled).toBe(true);
    expect(more().disabled).toBe(false);
  });

  it("a typed digit saves at once, clamped to the upper limit; a cleared field shows the saved value again on blur", () => {
    const onSave = vi.fn();
    render(<Harness initial={2} onSave={onSave} />);
    fireEvent.change(field(), { target: { value: "9" } });
    expect(field().value).toBe("5");
    fireEvent.change(field(), { target: { value: "" } });
    expect(field().value).toBe("");
    fireEvent.blur(field());
    expect(field().value).toBe("5");
    expect(onSave.mock.calls).toEqual([[5]]);
  });

  it("Up, Down, Home and End change the value, never past the limits, and do not reach a surrounding menu", () => {
    const onSave = vi.fn();
    const outer = vi.fn();
    render(<div onKeyDown={outer}><Harness initial={4} onSave={onSave} /></div>);
    for (const key of ["ArrowUp", "ArrowUp", "Home", "ArrowDown", "End"]) fireEvent.keyDown(field(), { key });
    expect(onSave.mock.calls).toEqual([[5], [1], [5]]);
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "a" });
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("focusing the field selects its whole value, so the next digit typed replaces it", () => {
    render(<Harness initial={3} onSave={vi.fn()} />);
    const input = field();
    input.setSelectionRange(1, 1);
    fireEvent.focus(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 1]);
  });

  it("adds host classes beside its own jini-* classes", () => {
    const { container } = render(<Harness initial={2} onSave={vi.fn()} classNames={{ group: "stepper", step: "stepper__step", value: "stepper__value", tip: "visually-hidden" }} />);
    expect(container.querySelector('[role="group"]')!.className).toBe("jini-number-stepper stepper jini-tooltip");
    expect(more().className).toBe("jini-number-stepper__step stepper__step");
    expect(field().className).toBe("jini-number-stepper__value stepper__value jini-tooltip");
    expect(document.getElementById(field().getAttribute("aria-describedby")!)!.className).toBe("jini-number-stepper__tip visually-hidden");
  });
});
