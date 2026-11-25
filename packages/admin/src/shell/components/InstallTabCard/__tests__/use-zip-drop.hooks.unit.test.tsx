// @vitest-environment jsdom
import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ZipDropZone } from "../InstallTabCard.js";
import { useZipDrop } from "../use-zip-drop.hooks.js";

function renderDropZone() {
  const received: File[][] = [];
  const lock = { current: false };
  function Harness() {
    const drop = useZipDrop({ onDropFiles: ({ files }) => received.push(files), isLocked: () => lock.current });
    const inputRef = useRef<HTMLInputElement>(null);
    return <ZipDropZone drop={drop} glyph="+" title="Drop package" hint="ZIP files" busy={false}
      chooseLabel="Choose file" onChoose={() => inputRef.current?.click()} inputRef={inputRef}
      inputLabel="Package" onFileChange={() => {}} dropProps={{ "data-testid": "drop-zone" }} />;
  }
  render(<Harness />);
  return { zone: screen.getByTestId("drop-zone"), received, lock };
}

it("highlights an unlocked drag and clears the highlight when it leaves", () => {
  const { zone, received } = renderDropZone();
  expect(fireEvent.dragOver(zone)).toBe(false);
  expect(zone).toHaveClass("is-dragging");
  fireEvent.dragLeave(zone);
  expect(zone).not.toHaveClass("is-dragging");
  expect(received).toEqual([]);
});

it("passes all dropped files in order and clears the drag highlight", () => {
  const { zone, received } = renderDropZone();
  const first = new File(["first"], "first.zip", { type: "application/zip" });
  const second = new File(["second"], "second.zip", { type: "application/zip" });
  fireEvent.dragOver(zone);
  expect(fireEvent.drop(zone, { dataTransfer: { files: [first, second] } })).toBe(false);
  expect(zone).not.toHaveClass("is-dragging");
  expect(received).toEqual([[first, second]]);
});

it("prevents a locked drag from highlighting or delivering files", () => {
  const { zone, received, lock } = renderDropZone();
  lock.current = true;
  expect(fireEvent.dragOver(zone)).toBe(false);
  expect(zone).not.toHaveClass("is-dragging");
  expect(fireEvent.drop(zone, { dataTransfer: { files: [new File(["zip"], "package.zip")] } })).toBe(false);
  expect(received).toEqual([]);
});

it("clears an existing highlight when an upload locks before the drop", () => {
  const { zone, received, lock } = renderDropZone();
  fireEvent.dragOver(zone);
  expect(zone).toHaveClass("is-dragging");
  lock.current = true;
  fireEvent.drop(zone, { dataTransfer: { files: [new File(["zip"], "package.zip")] } });
  expect(zone).not.toHaveClass("is-dragging");
  expect(received).toEqual([]);
});

it("delivers an empty list when a drop contains no files", () => {
  const { zone, received } = renderDropZone();
  expect(fireEvent.drop(zone, { dataTransfer: { files: [] } })).toBe(false);
  expect(received).toEqual([[]]);
});

it("delivers an empty list when the drop's dataTransfer carries no files list at all", () => {
  const { zone, received } = renderDropZone();
  expect(fireEvent.drop(zone, { dataTransfer: {} })).toBe(false);
  expect(received).toEqual([[]]);
});
