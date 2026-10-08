import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Select, type SelectOption } from "../components/Select/Select.js";

/** Phase 17/P1: exercise the real Select hook and portal, rather than an injected dropdown fake.
 * jsdom can verify DOM ownership, focus, geometry inputs and canceled key events; native modal
 * top-layer painting, inertness and Escape-to-cancel dispatch still require browser validation. */
const OPTIONS: SelectOption[] = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo" },
  { value: "c", label: "Charlie" },
];
const SEARCH_OPTIONS = [...OPTIONS, ...["Delta", "Echo", "Foxtrot", "Golf", "Hotel"].map(
  (label) => ({ value: label.toLowerCase(), label }),
)];

describe("Select portal ownership", () => {
  it("defaults to a body portal outside a dialog and preserves keyboard selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<Select value="" onChange={onChange} options={OPTIONS} aria-label="Pick one" />);
    const trigger = screen.getByRole("combobox", { name: "Pick one" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");

    const panel = screen.getByRole("listbox").parentElement!;
    expect(panel.parentElement).toBe(document.body);
    expect(container.contains(panel)).toBe(false);
    expect(panel).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("defaults to the nearest dialog, outside its scrolling body", async () => {
    const user = userEvent.setup();
    render(
      <dialog open data-testid="outer-dialog">
        <dialog open data-testid="inner-dialog">
          <div data-testid="scrolling-body" style={{ overflow: "auto" }}>
            <Select value="" onChange={vi.fn()} options={OPTIONS} aria-label="Pick one" />
          </div>
        </dialog>
      </dialog>,
    );
    await user.click(screen.getByRole("combobox", { name: "Pick one" }));

    const panel = screen.getByRole("listbox").parentElement!;
    expect(panel.parentElement).toBe(screen.getByTestId("inner-dialog"));
    expect(screen.getByTestId("scrolling-body").contains(panel)).toBe(false);
    expect(panel).toHaveFocus();
  });

  it.each([false, true])("honors a host-owned container (inside dialog: %s)", async (insideDialog) => {
    const user = userEvent.setup();
    const portalContainer = document.createElement("section");
    const host = document.createElement(insideDialog ? "dialog" : "div");
    if (insideDialog) host.setAttribute("open", "");
    document.body.append(host);
    try {
      const view = render(
        <Select value="" onChange={vi.fn()} options={OPTIONS} aria-label="Pick one" />,
        { container: host },
      );
      // React owns the host's initial content; attach the separate overlay region after mounting.
      host.append(portalContainer);
      const trigger = screen.getByRole("combobox", { name: "Pick one" });
      await user.click(trigger);
      expect(screen.getByRole("listbox").parentElement!.parentElement).toBe(insideDialog ? host : document.body);
      await user.keyboard("{Escape}");

      view.rerender(<Select value="" onChange={vi.fn()} options={OPTIONS} aria-label="Pick one" portalContainer={portalContainer} />);
      await user.click(trigger);
      expect(screen.getByRole("listbox").parentElement!.parentElement).toBe(portalContainer);
      await user.keyboard("{Escape}");
      expect(portalContainer.childElementCount).toBe(0);
      expect(trigger).toHaveFocus();
      view.unmount();
    } finally {
      host.remove();
    }
  });

  it("keeps search and keyboard selection inside the dialog", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<dialog open><Select value="" onChange={onChange} options={SEARCH_OPTIONS} aria-label="Pick one" /></dialog>);
    const trigger = screen.getByRole("combobox", { name: "Pick one" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("textbox", { name: "Search options" })).toHaveFocus();
    await user.keyboard("brav{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("consumes the first Escape and lets the host receive the next Escape", async () => {
    const user = userEvent.setup();
    const onHostKeyDown = vi.fn();
    const onChange = vi.fn();
    render(
      <dialog open onKeyDown={onHostKeyDown}>
        <Select value="" onChange={onChange} options={OPTIONS} aria-label="Pick one" />
      </dialog>,
    );
    const trigger = screen.getByRole("combobox", { name: "Pick one" });
    await user.click(trigger);
    const panel = screen.getByRole("listbox").parentElement!;
    expect(fireEvent.keyDown(panel, { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    expect(onHostKeyDown).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(trigger, { key: "Escape" })).toBe(true);
    expect(onHostKeyDown).toHaveBeenCalledTimes(1);
    // jsdom does not translate the second Escape into a native dialog cancel event.
  });

  it.each([
    { shift: false, before: true, after: true, target: "after" },
    { shift: true, before: true, after: true, target: "before" },
    { shift: false, before: true, after: false, target: "before" },
    { shift: true, before: false, after: true, target: "after" },
    { shift: false, before: false, after: false, target: "Pick one" },
  ])("keeps Tab inside a modal dialog: %j", async ({ shift, before, after, target }) => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside before</button>
        <dialog open data-testid="modal-dialog">
          {before ? <button type="button">before</button> : null}
          <Select value="" onChange={vi.fn()} options={SEARCH_OPTIONS} aria-label="Pick one" />
          {after ? <button type="button">after</button> : null}
        </dialog>
        <button type="button">outside after</button>
      </>,
    );
    const dialog = screen.getByTestId("modal-dialog");
    const matches = dialog.matches.bind(dialog);
    // jsdom has no showModal(): fake only the browser's modal-state query, keeping real DOM/focus.
    const modalState = vi.spyOn(dialog, "matches").mockImplementation((selector) => selector === ":modal" || matches(selector));
    try {
      await user.click(screen.getByRole("combobox", { name: "Pick one" }));
      expect(screen.getByRole("textbox", { name: "Search options" })).toHaveFocus();
      await user.keyboard(shift ? "{Shift>}{Tab}{/Shift}" : "{Tab}");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.getByRole(target === "Pick one" ? "combobox" : "button", { name: target })).toHaveFocus();
    } finally {
      modalState.mockRestore();
    }
  });

  it.each([false, true])("lets Tab leave a non-modal dialog (backward: %s)", async (shift) => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside before</button>
        <dialog open><Select value="" onChange={vi.fn()} options={OPTIONS} aria-label="Pick one" /></dialog>
        <button type="button">outside after</button>
      </>,
    );
    const trigger = screen.getByRole("combobox", { name: "Pick one" });
    const dialog = trigger.closest("dialog")!;
    const matches = dialog.matches.bind(dialog);
    // jsdom cannot query :modal even for a non-modal dialog; fake only that browser state.
    const modalState = vi.spyOn(dialog, "matches").mockImplementation((selector) => selector === ":modal" ? false : matches(selector));
    try {
      await user.click(trigger);
      await user.keyboard(shift ? "{Shift>}{Tab}{/Shift}" : "{Tab}");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: shift ? "outside before" : "outside after" })).toHaveFocus();
    } finally {
      modalState.mockRestore();
    }
  });

  it.each([false, true])("preserves viewport positioning and repositioning in a dialog (upward: %s)", async (upward) => {
    const user = userEvent.setup();
    render(<dialog open><Select value="" onChange={vi.fn()} options={OPTIONS} aria-label="Pick one" /></dialog>);
    const trigger = screen.getByRole("combobox", { name: "Pick one" });
    const top = upward ? window.innerHeight - 40 : 100;
    const measure = vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top, bottom: top + 30, left: 20, right: 220, width: 200, height: 30, x: 20, y: top, toJSON() {},
    });
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => trigger;
    try {
      await user.click(trigger);
      const panel = screen.getByRole("listbox").parentElement!;
      expect(panel).toHaveStyle(upward
        ? { bottom: "44px", left: "20px", width: "200px" }
        : { top: "134px", left: "20px", width: "200px" });
      measure.mockReturnValue({
        top: 80, bottom: 110, left: 40, right: 240, width: 200, height: 30, x: 40, y: 80, toJSON() {},
      });
      act(() => window.dispatchEvent(new Event("scroll")));
      expect(panel).toHaveStyle({ top: "114px", left: "40px", width: "200px" });
      expect(panel.style.bottom).toBe("");
      measure.mockReturnValue({
        top: 60, bottom: 90, left: 50, right: 250, width: 200, height: 30, x: 50, y: 60, toJSON() {},
      });
      act(() => window.dispatchEvent(new Event("resize")));
      expect(panel).toHaveStyle({ top: "94px", left: "50px", width: "200px" });
    } finally {
      document.elementFromPoint = originalElementFromPoint;
      measure.mockRestore();
    }
  });

  it("ignores option mousedown and dismisses on a click elsewhere in the dialog", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <dialog open>
        <Select value="" onChange={onChange} options={OPTIONS} aria-label="Pick one" />
        <button type="button">elsewhere</button>
      </dialog>,
    );
    await user.click(screen.getByRole("combobox", { name: "Pick one" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Alpha" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "elsewhere" })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });
});
