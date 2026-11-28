// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatSettingsSegmented } from "../ChatSettingsSegmented.js";

afterEach(cleanup);

it("inside a menu host, renders menuitemradio options with aria-checked, hands the checked one to checkedRef and routes a click to its own item", () => {
  const checkedRef = vi.fn();
  const showChange = vi.fn();
  const hideChange = vi.fn();
  render(<ChatSettingsSegmented name="tool-calls" inputRole="menuitemradio" checkedRef={checkedRef} items={[
    { key: "show", label: "Show", change: showChange },
    { key: "hide", label: "Hide", checked: true, change: hideChange },
  ]} />);
  const options = screen.getAllByRole("menuitemradio");
  expect(options.map(option => option.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  expect(checkedRef.mock.calls.filter(([input]) => input !== null)).toEqual([[screen.getByLabelText("Hide")]]);
  fireEvent.click(screen.getByLabelText("Show"));
  expect(showChange).toHaveBeenCalledTimes(1);
  expect(hideChange).not.toHaveBeenCalled();
});

it("with nothing checked and no menu role, focuses the first option and sets no aria-checked", () => {
  const checkedRef = vi.fn();
  render(<ChatSettingsSegmented name="plugins" checkedRef={checkedRef} items={[
    { key: "on", label: "On", change: vi.fn() },
    { key: "off", label: "Off", change: vi.fn() },
  ]} />);
  const radios = screen.getAllByRole("radio");
  expect(radios.map(radio => radio.hasAttribute("aria-checked"))).toEqual([false, false]);
  expect(checkedRef.mock.calls.filter(([input]) => input !== null)).toEqual([[screen.getByLabelText("On")]]);
});
