// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminMenuItem } from "../api/menus-api.types.js";
import { MenuPageLinkFields } from "../MenuPageLinkFields.js";
import type { useMenuPageLinkFields } from "../MenuPageLinkFields.hooks.js";

afterEach(cleanup);

const item: AdminMenuItem = { id: "about", label: "About", target: { kind: "entryRef", entryId: "about" } };

/** A hook double with fixed state, so the component is checked without the real page-link rules. */
function fakeHook(unavailable: boolean): typeof useMenuPageLinkFields {
  return () => ({ value: "about", choices: [{ id: "about", title: "Our story" }], unavailable, selectPage: () => {} }) as unknown as ReturnType<typeof useMenuPageLinkFields>;
}

describe("MenuPageLinkFields", () => {
  it("renders the injected hook's state, never a default hook", () => {
    const onChange = vi.fn();
    const hook = vi.fn(fakeHook(false));
    render(<MenuPageLinkFields item={item} path={[2]} pages={[]} onChange={onChange} t={(key) => `«${key}»`} useMenuPageLinkFields={hook} />);
    expect(hook).toHaveBeenCalledWith(expect.objectContaining({ item, path: [2], pages: [], onChange }));
    expect((screen.getByRole("combobox", { name: "«Page»" }) as HTMLSelectElement).value).toBe("about");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("uses only engine-prefixed classes for the label wrap, hidden text and unpublished hint", () => {
    const { container } = render(<MenuPageLinkFields item={item} path={[0]} onChange={() => {}} t={(key) => key} useMenuPageLinkFields={fakeHook(true)} />);
    expect(container.querySelector("label")?.className).toBe("jini-menu-page-link-label");
    expect(screen.getByText("Page", { selector: "span" }).className).toBe("jini-menu-page-link-visually-hidden");
    expect(screen.getByRole("status").className).toBe("jini-menu-page-link-unavailable");
    const classes = [...container.querySelectorAll("[class]")].flatMap((node) => [...node.classList]);
    expect(classes.every((name) => name.startsWith("jini-"))).toBe(true);
  });
});
