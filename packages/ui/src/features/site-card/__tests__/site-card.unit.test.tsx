// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SiteCard, SiteCardStatus } from "../SiteCard";
import { SiteCardPin, SiteListToolbar, type SiteListToolbarCopy } from "../SiteListToolbar";

const copy: SiteListToolbarCopy = { views: "Which sites", pinnedRecent: "Recent + Pinned", all: "All sites (3)", hidden: "Hidden (1)", sortBy: "Sort by", recent: "Most recent", oldest: "Oldest", name: "A-Z" };
const controller = (overrides = {}) => ({ filter: "pinned-recent" as const, setFilter: vi.fn(), sort: "recent" as const, setSort: vi.fn(), hiddenCount: 1, ...overrides });

describe("SiteCard", () => {
  it("fills the head in reading order: name, menu, details, status, then notes", () => {
    const { container } = render(<SiteCard name="Atlas" menu={<button>menu</button>} details="SQLite" status={<SiteCardStatus label="Running" tone="running" />} notes={<p>note</p>} />);
    const head = container.querySelector(".jini-site-card__head")!;
    expect([...head.children].map((cell) => cell.textContent)).toEqual(["Atlas", "menu", "SQLite", "Running", "note"]);
  });

  it("keeps the menu level with the name when a long second line makes that cell taller", () => {
    // Centred in the row, the menu slid down the card and sat lower than on the cards beside it.
    const css = readFileSync(`${__dirname}/../site-card.css`, "utf8");
    expect(css).toMatch(/\.jini-site-card__menu \{[^}]*align-self: start;/);
  });

  it("keeps the menu's cell when it has no menu, so the details stay in the first column", () => {
    const { container } = render(<SiteCard name="Atlas" details="SQLite" />);
    expect(container.querySelector(".jini-site-card__head")!.children[1]!.className).toBe("jini-site-card__menu");
  });

  it("shows the capture when there is one and a neutral placeholder otherwise", () => {
    const onError = vi.fn();
    const { container, rerender } = render(<SiteCard name="Atlas" previewSrc="/shot.png" onPreviewError={onError} />);
    const image = container.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("/shot.png");
    fireEvent.error(image);
    expect(onError).toHaveBeenCalledOnce();
    rerender(<SiteCard name="Atlas" previewSrc={null} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".jini-site-card__placeholder")).not.toBeNull();
  });

  it("gives the whole name as a tooltip and passes extra attributes to the article", () => {
    render(<SiteCard name="A very long name" title="/sites/atlas" className="extra" />);
    expect(screen.getByRole("heading", { name: "A very long name" }).getAttribute("title")).toBe("A very long name");
    const article = screen.getByRole("article");
    expect(article.getAttribute("title")).toBe("/sites/atlas");
    expect(article.className).toBe("jini-site-card extra");
  });

  it("tints the status by tone", () => {
    const { container } = render(<SiteCardStatus label="Starting" tone="busy" title="Why" />);
    expect(container.querySelector(".jini-site-card__status--busy")!.getAttribute("title")).toBe("Why");
  });
});

describe("SiteCardPin", () => {
  it("toggles without reaching a clickable card behind it", () => {
    const onToggle = vi.fn();
    const onCard = vi.fn();
    render(<div onClick={onCard} onKeyDown={onCard}><SiteCardPin pinned label="Unpin Atlas" onToggle={onToggle} /></div>);
    const pin = screen.getByRole("button", { name: "Unpin Atlas" });
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(pin, { key: "Enter" });
    fireEvent.click(pin);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onCard).not.toHaveBeenCalled();
  });
});

describe("SiteListToolbar", () => {
  it("offers Hidden only once something is hidden", () => {
    const { rerender } = render(<SiteListToolbar list={controller()} copy={copy} />);
    expect(screen.getByRole("button", { name: "Hidden (1)" })).toBeTruthy();
    rerender(<SiteListToolbar list={controller({ hiddenCount: 0 })} copy={copy} />);
    expect(screen.queryByRole("button", { name: "Hidden (1)" })).toBeNull();
  });

  it("marks the open view and reports a change of view and of sort", () => {
    const list = controller();
    render(<SiteListToolbar list={list} copy={copy} />);
    expect(screen.getByRole("button", { name: "Recent + Pinned" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "All sites (3)" }));
    expect(list.setFilter).toHaveBeenCalledWith("all");
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "name" } });
    expect(list.setSort).toHaveBeenCalledWith("name");
  });
});
