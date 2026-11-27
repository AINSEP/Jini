// @vitest-environment jsdom
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { KitChatSettingsSegmentedProps } from "../../../react/kit.js";
import { Segments } from "../EmailSegments.js";

function NativeSegments({ name, items }: KitChatSettingsSegmentedProps) {
  return <>{items.map(({ key, label, checked, change }) => (
    <label key={key}><input type="radio" name={name} checked={checked} onChange={() => change()} />{label}</label>
  ))}</>;
}

it("names the group, exposes the selected radio, and delivers the clicked section key", async () => {
  const onSelect = vi.fn();
  function Harness() {
    const [active, setActive] = useState("status");
    return <Segments name="email-overview" label="Overview section" active={active} items={[
      { key: "status", label: "Status" }, { key: "test", label: "Test send" },
    ]} onSelect={key => { onSelect(key); setActive(key); }} kit={{ ChatSettingsSegmented: NativeSegments }} />;
  }
  render(<Harness />);
  const group = within(screen.getByRole("radiogroup", { name: "Overview section" }));
  const status = group.getByRole("radio", { name: "Status" });
  const test = group.getByRole("radio", { name: "Test send" });
  expect(status).toHaveAttribute("name", "email-overview");
  expect(test).toHaveAttribute("name", "email-overview");
  expect(status).toBeChecked();
  expect(test).not.toBeChecked();
  await userEvent.click(test);
  expect(onSelect.mock.calls).toEqual([["test"]]);
  expect(test).toBeChecked();
  expect(status).not.toBeChecked();
});
