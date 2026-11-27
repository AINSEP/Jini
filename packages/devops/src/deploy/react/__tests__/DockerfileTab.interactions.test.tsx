// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { DockerfileTab, type DockerfileTabProps } from "../DockerfileTab.js";
import type { DockerfileSourceController } from "../hooks/use-dockerfile-source.hooks.js";

afterEach(cleanup);
const props: Omit<DockerfileTabProps, "useDockerfileSourceHook"> = {
  agentHandle, download: () => {}, dockerfileLineCountLabel: ({ count }) => `${count} draft lines`,
  lineIcon: { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
};
const defaultController: DockerfileSourceController = {
  snapshot: undefined, draft: "", setDraft: () => {}, isDirty: false, saving: false, error: null,
  saveError: null, saveConflict: null, reloadAfterConflict: async () => {}, saved: false,
  copied: false, copy: async () => {}, save: async () => {}, t: key => key,
};

it("opens an editable blank Dockerfile, then copies, downloads and saves the current draft", () => {
  const draft = "FROM scratch\nLABEL release=fixture\n";
  const copy = vi.fn<(value: string) => void>();
  const save = vi.fn<(value: string) => void>();
  const download = vi.fn<DockerfileTabProps["download"]>();
  function Harness() {
    const [value, setDraft] = useState("");
    const [saved, setSaved] = useState(false);
    const [copied, setCopied] = useState(false);
    return <DockerfileTab {...props} download={download} useDockerfileSourceHook={() => ({
      ...defaultController, snapshot: { exists: false, contents: null, etag: '"missing"' }, draft: value, setDraft, saved, copied, isDirty: value !== "" && !saved,
      copy: async () => { copy(value); setCopied(true); }, save: async () => { save(value); setSaved(true); },
    })} />;
  }
  render(<Harness />);
  expect(screen.getByRole("heading", { name: "No Dockerfile yet" }).tagName).toBe("H2");
  const editor = screen.getByRole("textbox", { name: "Dockerfile contents" }) as HTMLTextAreaElement;
  const copyButton = screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement;
  const downloadButton = screen.getByRole("button", { name: "Download" }) as HTMLButtonElement;
  expect([editor.value, copyButton.disabled, downloadButton.disabled]).toEqual(["", true, true]);

  fireEvent.change(editor, { target: { value: draft } });
  expect(editor.value).toBe(draft);
  expect(screen.getByText("2 draft lines").textContent).toBe("2 draft lines");
  expect(screen.getByText("Unsaved changes").textContent).toBe("Unsaved changes");
  act(() => copyButton.click());
  act(() => downloadButton.click());
  act(() => screen.getByRole("button", { name: "Save" }).click());
  expect(copy.mock.calls).toEqual([[draft]]);
  expect(download.mock.calls).toEqual([[{ contents: draft }]]);
  expect(save.mock.calls).toEqual([[draft]]);
  expect(screen.getByText("Copied!").getAttribute("aria-live")).toBe("polite");
  expect(screen.getByText("Saved").textContent).toBe("Saved");
  expect(screen.queryByText("Unsaved changes")).toBeNull();
});

it("shows load and save failures separately and reloads a deleted version without replacing the draft", () => {
  const reload = vi.fn(async () => {});
  const draft = "FROM local";
  const renderState = (over: Partial<DockerfileSourceController>) =>
    <DockerfileTab {...props} useDockerfileSourceHook={() => ({ ...defaultController, ...over })} />;
  const { rerender } = render(renderState({ error: "Workspace unavailable" }));
  expect(screen.getByText("Workspace unavailable").textContent).toBe("Workspace unavailable");
  expect(screen.queryByRole("textbox")).toBeNull();

  const editing = { snapshot: { exists: true, contents: "FROM server", etag: '"server"' }, draft };
  rerender(renderState({ ...editing, error: "Refresh failed", saveError: "Save failed" }));
  expect(screen.getByText("Refresh failed").textContent).toBe("Refresh failed");
  expect(screen.getByRole("alert").textContent).toBe("Save failed");

  rerender(renderState({ ...editing, saveError: "Save failed", saveConflict: { exists: false, contents: null }, reloadAfterConflict: reload }));
  expect(screen.queryByText("Save failed")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("It was deleted on the server.");
  act(() => screen.getByRole("button", { name: "Load the current version" }).click());
  expect(reload.mock.calls).toEqual([[]]);
  expect((screen.getByRole("textbox", { name: "Dockerfile contents" }) as HTMLTextAreaElement).value).toBe(draft);
});
