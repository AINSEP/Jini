// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRef } from "react";
import userEvent from "@testing-library/user-event";
import { useZipDrop } from "../use-zip-drop.hooks.js";
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstallTabAdvanced, InstallTabCard, InstallTabFieldRow, InstallTabOption, ZipDropZone } from "../InstallTabCard.js";

/**
 * @file The install card's field row as a form: Enter or the button submits through the host's
 * handler, and without one the form never navigates the admin away (the browser's default submit).
 */

afterEach(cleanup);

describe("InstallTabFieldRow", () => {
  it("swallows the browser's default submit when the host gives no handler", () => {
    render(<InstallTabFieldRow inputId="url" label="GitHub URL" value="" onChange={() => {}} action={{ label: "Install" }} />);
    const form = screen.getByRole("button", { name: "Install" }).closest("form")!;
    const submit = createEvent.submit(form);
    fireEvent(form, submit);
    expect(submit.defaultPrevented).toBe(true);
  });

  it("hands a submit to the host's handler instead", () => {
    const onSubmit = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(<InstallTabFieldRow inputId="url" placeholder="Server path" value="" onChange={() => {}} onSubmit={onSubmit} />);
    // No label: the placeholder names the field, and there is no button beside it.
    const input = screen.getByRole("textbox", { name: "Server path" });
    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.submit(input.closest("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("InstallTabCard", () => {
  it("titles its section and renders the lede and content", () => {
    render(<InstallTabCard titleId="t1" title="Add a skill" lede="From GitHub or a ZIP.">body</InstallTabCard>);
    expect(screen.getByRole("heading", { name: "Add a skill" })).toHaveAttribute("id", "t1");
    expect(screen.getByText("From GitHub or a ZIP.")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});

it("a drag changes the dropzone outline without changing its accessible name", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../install-tab-card.css"), "utf8");
  function Card() {
    const drop = useZipDrop({ onDropFiles: vi.fn(), isLocked: () => false });
    return <div className="page"><InstallTabCard titleId="install-title" title="Install">
      <InstallTabOption heading="Soon" badge="Coming soon" />
      <ZipDropZone drop={drop} glyph="+" title="Drop a ZIP" hint="One package"
        busy={false} chooseLabel="Choose a file" onChoose={vi.fn()} inputRef={createRef<HTMLInputElement>()}
        inputLabel="Package ZIP" onFileChange={vi.fn()} dropProps={{ role: "region", "aria-label": "Drop a ZIP" }} />
    </InstallTabCard></div>;
  }
  const { container } = render(<Card />);
  const zone = screen.getByRole("region", { name: "Drop a ZIP" });
  expect(zone).not.toHaveClass("jini-install-tab-is-dragging");
  fireEvent.dragOver(zone);
  expect(zone).toHaveClass("jini-install-tab-is-dragging");
  expect(screen.getByRole("region", { name: "Drop a ZIP" })).toBe(zone);
  expect(container.querySelector(".jini-install-tab-is-soon")).not.toBeNull();
  for (const node of container.querySelectorAll("[class]")) {
    for (const token of node.classList) if (token.startsWith("jini-install-tab-")) expect(css).toContain(`.${token}`);
  }
  expect(css).not.toMatch(/\.is-(soon|dragging)\b/);
  fireEvent.dragLeave(zone);
  expect(zone).not.toHaveClass("jini-install-tab-is-dragging");
});

it("opens the advanced disclosure and exposes its server-path control", async () => {
  const user = userEvent.setup();
  render(<InstallTabCard titleId="plugin-title" title="Add a plugin">
    <InstallTabOption hint="Only use a path on this server.">
      <InstallTabAdvanced summary="Advanced" hint="Choose an existing directory on the server." summaryProps={{ "data-agent-element": "advanced-install" }}>
        <InstallTabFieldRow inputId="path" label="Directory" />
      </InstallTabAdvanced>
    </InstallTabOption>
  </InstallTabCard>);
  const disclosure = screen.getByText("Advanced");
  const details = disclosure.closest("details");
  expect(details?.open).toBe(false);
  expect(disclosure.getAttribute("data-agent-element")).toBe("advanced-install");
  await user.click(disclosure);
  expect(details?.open).toBe(true);
  expect(screen.getByRole("textbox", { name: "Directory" }).id).toBe("path");
  expect(screen.getByText("Choose an existing directory on the server.").textContent).toBe("Choose an existing directory on the server.");
  expect(screen.getByText("Only use a path on this server.").textContent).toBe("Only use a path on this server.");
});

it("offers a distinct multi-file folder picker and disables both choose actions while busy", async () => {
  const user = userEvent.setup();
  const onChoose = vi.fn();
  const onChooseFolder = vi.fn();
  const onFilesChange = vi.fn();
  const inputRef = createRef<HTMLInputElement>();
  const folderRef = createRef<HTMLInputElement>();
  function Card({ busy }: { busy: boolean }) {
    const drop = useZipDrop({ onDropFiles: vi.fn(), isLocked: () => busy });
    return <ZipDropZone drop={drop} glyph="+" title="Drop ZIP" hint="ZIP or folder" busy={busy}
      chooseLabel="Choose archive" onChoose={onChoose} inputRef={inputRef} inputLabel="ZIP package" onFileChange={vi.fn()}
      folder={{ label: "Choose directory", inputLabel: "Package directory", inputRef: folderRef, onFilesChange, onChoose: onChooseFolder }} />;
  }
  const { rerender } = render(<Card busy={false} />);
  const folder = screen.getByRole("button", { name: "Choose directory" });
  const archive = screen.getByRole("button", { name: "Choose archive" });
  const picker = screen.getByLabelText("Package directory") as HTMLInputElement;
  expect(folderRef.current).toBe(picker);
  expect(picker.hidden).toBe(true);
  expect(picker.multiple).toBe(true);
  expect(picker.getAttribute("webkitdirectory")).toBe("");
  expect(inputRef.current?.accept).toBe(".zip,application/zip");
  await user.click(folder);
  expect(onChooseFolder).toHaveBeenCalledOnce();
  expect(onChoose).not.toHaveBeenCalled();
  const files = [new File(["payload"], "SKILL.md"), new File(["notes"], "README.md")];
  await user.upload(picker, files);
  expect(Array.from(picker.files ?? [])).toEqual(files);
  expect(onFilesChange).toHaveBeenCalledOnce();
  rerender(<Card busy />);
  expect(folder).toBeDisabled();
  expect(archive).toBeDisabled();
  await user.click(folder);
  expect(onChooseFolder).toHaveBeenCalledOnce();
});
