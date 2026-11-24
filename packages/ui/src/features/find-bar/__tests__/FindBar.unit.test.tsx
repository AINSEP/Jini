// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FindBar, type FindBarLabels, type FindBarModel } from "../FindBar.js";

const labels: FindBarLabels = {
  field: "Search here", previous: "Back", previousTip: "Back (Shift+Enter)", next: "Forward", nextTip: "Forward (Enter)", close: "Shut", closeTip: "Shut (Esc)",
};

function fakeFind(fields: Partial<FindBarModel> = {}) {
  const calls: string[] = [];
  const find: FindBarModel = {
    open: true, query: "alpha", countLabel: "2 of 5", inputRef: () => {},
    setQuery: ({ text }) => { calls.push(`query:${text}`); },
    next: () => { calls.push("next"); }, previous: () => { calls.push("previous"); }, close: () => { calls.push("close"); },
    ...fields,
  };
  return { find, calls };
}

describe("FindBar", () => {
  it("renders nothing while closed", () => {
    const { container } = render(<FindBar find={fakeFind({ open: false }).find} labels={labels} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the query, the count and the host's words, and typing hands the text to setQuery", () => {
    const { find, calls } = fakeFind();
    const { container, getByRole } = render(<FindBar find={find} labels={labels} />);
    const input = container.querySelector<HTMLInputElement>(".jini-findbar__input")!;
    expect(container.querySelector(".jini-findbar")?.getAttribute("role")).toBe("search");
    expect(input.value).toBe("alpha");
    expect(input.getAttribute("aria-label")).toBe("Search here");
    expect(input.getAttribute("placeholder")).toBe("Search here");
    expect(container.querySelector(".jini-findbar__count")?.textContent).toBe("2 of 5");
    expect(getByRole("button", { name: "Back" }).getAttribute("title")).toBe("Back (Shift+Enter)");
    expect(getByRole("button", { name: "Forward" }).getAttribute("title")).toBe("Forward (Enter)");
    expect(getByRole("button", { name: "Shut" }).getAttribute("title")).toBe("Shut (Esc)");
    fireEvent.change(input, { target: { value: "alpha beta" } });
    expect(calls).toEqual(["query:alpha beta"]);
  });

  it("Enter steps forward, Shift+Enter back, Escape closes, other keys are left alone", () => {
    const { find, calls } = fakeFind();
    const { container } = render(<FindBar find={find} labels={labels} />);
    const input = container.querySelector<HTMLInputElement>(".jini-findbar__input")!;
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(false);
    expect(fireEvent.keyDown(input, { key: "Escape" })).toBe(false);
    expect(fireEvent.keyDown(input, { key: "a" })).toBe(true);
    expect(calls).toEqual(["next", "previous", "close"]);
  });

  it("buttons run their own action, and previous/next are disabled for an empty query", () => {
    const { find, calls } = fakeFind();
    const view = render(<FindBar find={find} labels={labels} />);
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    fireEvent.click(view.getByRole("button", { name: "Forward" }));
    fireEvent.click(view.getByRole("button", { name: "Shut" }));
    expect(calls).toEqual(["previous", "next", "close"]);
    view.rerender(<FindBar find={fakeFind({ query: "" }).find} labels={labels} />);
    expect((view.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByRole("button", { name: "Forward" }) as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByRole("button", { name: "Shut" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
