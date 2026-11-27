import { act, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { expect, it, vi } from "vitest";
import type { UserFacingError } from "@jini-ai/core";
import type { AdminKitHooks } from "../kit.js";
import { fakeAdminKit, fixtureQuery } from "../testing-kit.js";

it("preserves the lightweight fixture's field, select, switch and menu input contracts", async () => {
  const kit = fakeAdminKit();
  const { TextField, TextArea, Select, Switch, Menu, IconButton } = kit.components;
  const user = userEvent.setup();
  const changeText = vi.fn();
  const changeNotes = vi.fn();
  const changeMode = vi.fn();
  const toggle = vi.fn();
  const run = vi.fn();
  const disabled = vi.fn();
  const ref = createRef<HTMLButtonElement>();
  render(<>
    <TextField label="Name" value="" type="text" onValueChange={changeText} />
    <TextArea label="Notes" value="" onValueChange={changeNotes} />
    <Select label="Mode" value="read" options={[{ value: "read", label: "Read" }, { value: "write", label: "Write" }, { value: "owner", label: "Owner", disabled: true }]} onValueChange={changeMode} />
    <Switch label="Notify" checked={false} onCheckedChange={toggle} />
    <Menu label="Actions" items={[{ id: "edit", label: "Edit", onPress: run }, { id: "locked", label: "Locked", disabled: true, onPress: disabled }]} />
    <IconButton label="Save icon" ref={ref} pending onPress={disabled}>+</IconButton>
  </>);
  await user.type(screen.getByRole("textbox", { name: "Name" }), "J");
  await user.type(screen.getByRole("textbox", { name: "Notes" }), "R");
  await user.selectOptions(screen.getByRole("combobox", { name: "Mode" }), "write");
  await user.selectOptions(screen.getByRole("combobox", { name: "Mode" }), "owner");
  await user.click(screen.getByRole("switch", { name: "Notify" }));
  const menu = within(screen.getByRole("menu", { name: "Actions" }));
  await user.click(menu.getByRole("menuitem", { name: "Edit" }));
  await user.click(menu.getByRole("menuitem", { name: "Locked" }));
  const icon = screen.getByRole("button", { name: "Save icon" });
  expect(ref.current).toBe(icon);
  expect(icon).toBeDisabled();
  await user.click(icon);
  expect([changeText.mock.calls, changeNotes.mock.calls, changeMode.mock.calls, toggle.mock.calls, run.mock.calls]).toEqual([
    [[{ value: "J" }]], [[{ value: "R" }]], [[{ value: "write" }]], [[{ checked: true }]], [[{}]],
  ]);
  expect(disabled.mock.calls).toEqual([]);
});

it("keeps local shell selection until the host controls it and reports requested tab IDs", async () => {
  const user = userEvent.setup();
  const { SettingsDialogShell } = fakeAdminKit().components;
  const onActiveTabIdChange = vi.fn();
  const tabs = [
    { id: "general", label: "General", panel: "General configuration" },
    { id: "identity", label: "Identity", panel: "Identity configuration" },
  ];
  const view = render(<SettingsDialogShell tabs={tabs} initialActiveTabId="identity" onActiveTabIdChange={onActiveTabIdChange} />);
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Identity configuration");
  await user.click(screen.getByRole("tab", { name: "General" }));
  expect(screen.getByRole("tabpanel")).toHaveTextContent("General configuration");
  view.rerender(<SettingsDialogShell tabs={tabs} activeTabId="identity" onActiveTabIdChange={onActiveTabIdChange} />);
  await user.click(screen.getByRole("tab", { name: "General" }));
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Identity configuration");
  expect(onActiveTabIdChange.mock.calls).toEqual([["general"], ["general"]]);
});

it("keeps fake select filtering, disabled opening and callback delivery in sync", () => {
  const kit = fakeAdminKit();
  const onChange = vi.fn();
  const amber = { value: "amber", label: "Amber" };
  const blue = { value: "blue", label: "Bright Blue" };
  const props = { value: "amber", onChange, options: [amber, blue] };
  const { result, rerender } = renderHook(({ disabled }) => kit.hooks.useSelectDropdown(props, { disabled }), { initialProps: { disabled: true } });
  act(() => result.current.openPanel());
  expect(result.current.open).toBe(false);
  expect(result.current.selectedOption).toEqual(amber);
  rerender({ disabled: false });
  act(() => { result.current.openPanel(); result.current.setQuery("BLUE"); });
  expect(result.current.open).toBe(true);
  expect(result.current.filtered).toEqual([blue]);
  act(() => result.current.selectOption(blue));
  expect(result.current.open).toBe(false);
  expect(onChange.mock.calls).toEqual([["blue"]]);
});

it("reports the clipboard adapter's latest result without using the real clipboard", async () => {
  const { hooks } = fakeAdminKit();
  const copyText = vi.fn<Parameters<AdminKitHooks["useCopyToClipboard"]>[0]["copyText"]>()
    .mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const { result } = renderHook(() => hooks.useCopyToClipboard({ copyText }));
  expect(result.current.copied).toBe(false);
  await act(async () => { expect(await result.current.copy("copied-details")).toBe(true); });
  expect(result.current.copied).toBe(true);
  await act(async () => { expect(await result.current.copy("denied-details")).toBe(false); });
  expect(result.current.copied).toBe(false);
  expect(copyText.mock.calls).toEqual([["copied-details"], ["denied-details"]]);
});

it("clears failure notices and never delivers a stale publish or notifies an unsubscribed listener", () => {
  const onPublish = vi.fn();
  const channel = fakeAdminKit().values.createFailureChannel({}, { onPublish });
  const failure: UserFacingError = { message: "Could not save", step: "save", action: "Try again", cause: "", copyText: "Could not save" };
  const notice = vi.fn(() => channel.getSnapshot());
  const unsubscribe = channel.subscribe(notice);
  const previous = channel.getGeneration();
  channel.publish({ failure, generation: previous });
  expect(channel.getSnapshot()).toEqual(failure);
  channel.reset();
  expect(channel.getSnapshot()).toBeNull();
  channel.publish({ failure, generation: previous });
  expect(channel.getSnapshot()).toBeNull();
  expect(notice.mock.results.map(item => item.value)).toEqual([failure, null]);
  unsubscribe();
  channel.publish({ failure });
  expect(onPublish.mock.calls).toEqual([[{ failure }], [{ failure }]]);
  expect(notice).toHaveBeenCalledTimes(2);
});

it("selects only available chat agents and leaves no requested model behind when none is available", () => {
  const { resolveChatPaneSelection } = fakeAdminKit().chat;
  const agents = [{ id: "down", name: "Down", available: false }, { id: "up", name: "Up" }, { id: "another", name: "Another" }];
  expect(resolveChatPaneSelection({ agents, requested: { agentId: "another", model: "chosen" } })).toEqual({ agentId: "another", model: "chosen" });
  expect(resolveChatPaneSelection({ agents, requested: { agentId: "down" } })).toEqual({ agentId: "up" });
  expect(resolveChatPaneSelection({ agents: [agents[0]!], requested: { agentId: "down", model: "unavailable" } })).toEqual({ agentId: "" });
});

it("delivers selected file objects and renders the preview content and close affordance", async () => {
  const { FileDropzone, PreviewModalShell } = fakeAdminKit().components;
  const onFiles = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  const file = new File(["document bytes"], "example.txt", { type: "text/plain" });
  render(<>
    <FileDropzone onFiles={onFiles} accept="text/plain" />
    <PreviewModalShell title="Draft preview" headerExtras={<p>Revision 9</p>}
      views={[{ id: "source", label: "Source", custom: <p>Draft body</p> }]} onClose={onClose} />
  </>);
  await user.upload(screen.getByLabelText("Drop files"), file);
  expect(onFiles.mock.calls).toEqual([[[file]]]);
  const modal = within(screen.getByRole("dialog", { name: "Draft preview" }));
  expect(modal.getByText("Revision 9")).toBeVisible();
  expect(modal.getByRole("region", { name: "Source" })).toHaveTextContent("Draft body");
  await user.click(modal.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "click" }));
});

it("keeps each fake hook's wrap choice and tip visibility independent", async () => {
  const { components, hooks } = fakeAdminKit();
  const { CodeWrapToggle, CodeWithLines, Button } = components;
  function CodePreview() {
    const { wrap, toggleWrap } = hooks.useCodeWrap();
    const tip = hooks.useInfoTip();
    return <>
      <CodeWrapToggle wrap={wrap} onToggle={toggleWrap} t={key => key} agentHandleId="wrap-code" />
      <CodeWithLines text="model: intent" wrap={wrap} />
      <Button onPress={tip.toggle}>Toggle help</Button>
      <Button onPress={tip.hide}>Hide help</Button>
      {tip.open ? <p role="status">Large lines can wrap.</p> : null}
    </>;
  }
  const user = userEvent.setup();
  render(<CodePreview />);
  const wrapButton = screen.getByRole("button", { name: "Wrap lines" });
  const code = screen.getByText("model: intent");
  expect(code).toHaveAttribute("data-wrap", "false");
  await user.click(wrapButton);
  expect(wrapButton).toHaveAttribute("aria-pressed", "true");
  expect(code).toHaveAttribute("data-wrap", "true");
  await user.click(screen.getByRole("button", { name: "Toggle help" }));
  expect(screen.getByRole("status")).toHaveTextContent("Large lines can wrap.");
  await user.click(screen.getByRole("button", { name: "Hide help" }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(code).toHaveAttribute("data-wrap", "true");
  await user.click(wrapButton);
  expect(wrapButton).toHaveAttribute("aria-pressed", "false");
});

it("uses supplied reads before fixture data and gives a save failure precedence over other slices", async () => {
  const adapter = fixtureQuery({ data: "initial fixture" });
  const fetch = vi.fn(async () => "actual supplied read");
  const fromPort = adapter.useCachedLoader({ key: ["actual"], fetch });
  const fromFixture = adapter.useCachedLoader({ key: ["fixture"] });
  await expect(fromPort.load()).resolves.toBe("actual supplied read");
  await expect(fromFixture.load()).resolves.toBe("initial fixture");
  expect(fetch.mock.calls).toEqual([[]]);

  const { mergeSaveStates, resolveInitialActiveTabId } = fakeAdminKit().values;
  const failed = { status: "error", message: "Transport refused" } as const;
  expect(mergeSaveStates({ states: [{ status: "saved" }, { status: "saving" }, failed] })).toEqual(failed);
  expect(mergeSaveStates({ states: [{ status: "idle" }, { status: "saved" }] })).toEqual({ status: "saved" });
  expect(mergeSaveStates({ states: [] })).toEqual({ status: "idle" });
  const tabs = [{ id: "first", label: "First", panel: null }, { id: "second", label: "Second", panel: null }];
  expect(resolveInitialActiveTabId({ tabs }, { initialTabId: "second" })).toBe("second");
  expect(resolveInitialActiveTabId({ tabs }, { initialTabId: "removed" })).toBe("first");
  expect(resolveInitialActiveTabId({ tabs: [] })).toBeNull();
});
