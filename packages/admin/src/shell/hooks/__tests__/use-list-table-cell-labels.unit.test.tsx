// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { labelListTableCells, useListTableCellLabels } from "../use-list-table-cell-labels.hooks.js";

/**
 * @file The phone card layout's column labels (mobile catalog P-4, 2026-10-06): every `.list-table`
 * body cell gets its column header's text as `data-label`, which `styles.css` prints in card mode.
 */

function table(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("labelListTableCells", () => {
  it.each([undefined, "Roles"])("excludes tooltip help from card labels with explicit title %s", (label) => {
    const root = table(`<table class="list-table">
      <thead><tr><th ${label === undefined ? "" : `data-label="${label}"`}>Roles<span class="jini-ui-info-tip">
        <span role="button">ⓘ</span><span hidden>Owner — full control, including users and site keys.</span>
      </span></th></tr></thead><tbody><tr><td>Owner</td></tr></tbody></table>`);
    labelListTableCells({ root, tableSelector: "table.list-table" });
    const cell = root.querySelector("td")!;
    expect(cell.getAttribute("data-label")).toBe("Roles");
    expect(cell.textContent).toBe("Owner");
    expect(root.querySelector("th .jini-ui-info-tip [hidden]")?.textContent)
      .toBe("Owner — full control, including users and site keys.");
  });

  it("prefers an explicit translated title over header text", () => {
    const root = table(`<table class="list-table">
      <thead><tr><th data-label="Rôles">Roles</th></tr></thead>
      <tbody><tr><td>Owner</td></tr></tbody></table>`);
    labelListTableCells({ root, tableSelector: "table.list-table" });
    expect(root.querySelector("td")?.getAttribute("data-label")).toBe("Rôles");
  });

  it("copies each header's text (minus sort glyphs) onto its column, honouring colspan", () => {
    const root = table(`<table class="list-table">
      <thead><tr><th>Title ⇅</th><th colspan="2">When</th><th></th></tr></thead>
      <tbody><tr><td>a</td><td>b</td><td>c</td><td>d</td></tr></tbody></table>`);
    labelListTableCells({ root, tableSelector: "table.list-table" });
    const labels = Array.from(root.querySelectorAll("td")).map((td) => td.getAttribute("data-label"));
    expect(labels).toEqual(["Title", "When", "When", null]);
  });

  it("gives a spanning cell no label and clears a stale one", () => {
    const root = table(`<table class="list-table">
      <thead><tr><th>A</th><th>B</th></tr></thead>
      <tbody><tr><td colspan="2" data-label="A">empty</td></tr></tbody></table>`);
    labelListTableCells({ root, tableSelector: "table.list-table" });
    expect(root.querySelector("td")?.hasAttribute("data-label")).toBe(false);
  });

  it("clears stale labels from body columns beyond the available headers", () => {
    const root = table(`<table class="list-table">
      <thead><tr><th>Title</th></tr></thead>
      <tbody><tr><td>Article</td><td data-label="Removed column">Extra value</td></tr></tbody></table>`);
    labelListTableCells({ root, tableSelector: "table.list-table" });
    expect(Array.from(root.querySelectorAll("td")).map((cell) => cell.getAttribute("data-label")))
      .toEqual(["Title", null]);
  });

  it("leaves body cells unchanged when the table head has no rows", () => {
    const root = table(`<table class="list-table"><thead></thead>
      <tbody><tr><td data-label="Existing">value</td></tr></tbody></table>`);
    labelListTableCells({ root, tableSelector: "table.list-table" });
    expect(root.querySelector("td")?.getAttribute("data-label")).toBe("Existing");
  });

  it("leaves tables without a header row, and non-list tables, alone", () => {
    const root = table(`<table class="list-table"><tbody><tr><td>x</td></tr></tbody></table>
      <table><thead><tr><th>H</th></tr></thead><tbody><tr><td>y</td></tr></tbody></table>`);
    labelListTableCells({ root, tableSelector: "table.list-table" });
    expect(root.querySelectorAll("td[data-label]")).toHaveLength(0);
  });
});

describe("useListTableCellLabels", () => {
  function Harness({ rows }: { rows: readonly string[] }) {
    const [root, setRoot] = useState<HTMLElement | null>(null);
    useListTableCellLabels({ root, tableSelector: "table.list-table" });
    return (
      <main ref={setRoot}>
        <table className="list-table">
          <thead><tr><th>Name</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r}><td>{r}</td></tr>)}</tbody>
        </table>
      </main>
    );
  }

  it("labels the first render and rows added later", async () => {
    const { container, rerender } = render(<Harness rows={["a"]} />);
    expect(container.querySelector("td")?.getAttribute("data-label")).toBe("Name");
    rerender(<Harness rows={["a", "b"]} />);
    await Promise.resolve();
    const labels = Array.from(container.querySelectorAll("td")).map((td) => td.getAttribute("data-label"));
    expect(labels).toEqual(["Name", "Name"]);
  });
});
