// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isEmptySidebarClick, useSidebarEmptyClickToggle } from "../use-sidebar-empty-click-toggle.hooks.js";

/**
 * @file `useSidebarEmptyClickToggle` — a click on blank sidebar space toggles the desktop rail; a
 * click on any control (nav link, its icon, the rail toggle button itself, a section heading button)
 * does not. The listener is a native `<nav>` listener, not a React handler, so React's root
 * delegation does not apply and dispatching a real `click` on the element is the honest test.
 */

function Wiring(props: { toggleRail: () => void; isDesktop?: (() => boolean) | undefined }) {
  useSidebarEmptyClickToggle({ toggleRail: props.toggleRail }, { isDesktop: props.isDesktop ?? (() => true) });
  return null;
}

function SidebarDom(props: { toggleRail: () => void; isDesktop?: () => boolean }) {
  return (
    <nav id="admin-sidebar" data-testid="nav">
      <div className="cms-section" data-testid="section">
        <div className="cms-section-label" data-testid="label">
          Content
        </div>
        <a href="/admin/pages" className="cms-item" data-testid="link">
          <svg data-testid="icon">
            <path data-testid="icon-path" d="M0 0" />
          </svg>
          <span data-testid="link-text">Pages</span>
        </a>
        <div className="cms-item" data-testid="soon-item">
          <svg data-testid="soon-icon"><path data-testid="soon-icon-path" d="M0 0" /></svg>
          <span data-testid="soon-text">Soon</span>
        </div>
        <button type="button" className="cms-section-toggle" data-testid="heading-button">
          People
        </button>
      </div>
      <div className="cms-rail-toggle-row" data-testid="toggle-row">
        <button type="button" className="cms-rail-toggle" data-testid="rail-toggle">
          <svg>
            <path data-testid="rail-toggle-path" d="M0 0" />
          </svg>
        </button>
      </div>
      <Wiring toggleRail={props.toggleRail} isDesktop={props.isDesktop} />
    </nav>
  );
}

function click(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("useSidebarEmptyClickToggle", () => {
  it.each(["nav", "section", "label", "toggle-row"])("toggles on a click on blank space (%s)", (id) => {
    const toggleRail = vi.fn();
    const { getByTestId } = render(<SidebarDom toggleRail={toggleRail} />);
    click(getByTestId(id));
    expect(toggleRail).toHaveBeenCalledTimes(1);
  });

  it.each(["link", "icon", "icon-path", "link-text", "heading-button", "rail-toggle", "rail-toggle-path"])(
    "does not toggle on a click on a control (%s)",
    (id) => {
      const toggleRail = vi.fn();
      const { getByTestId } = render(<SidebarDom toggleRail={toggleRail} />);
      click(getByTestId(id));
      expect(toggleRail).not.toHaveBeenCalled();
    },
  );

  it("does not toggle below the desktop breakpoint (mobile drawer has no rail)", () => {
    const toggleRail = vi.fn();
    const { getByTestId } = render(<SidebarDom toggleRail={toggleRail} isDesktop={() => false} />);
    click(getByTestId("nav"));
    expect(toggleRail).not.toHaveBeenCalled();
  });

  it.each(["soon-item", "soon-icon", "soon-icon-path", "soon-text"])(
    "does not treat an inert navigation row or its children as blank space (%s)",
    (id) => {
      const toggleRail = vi.fn();
      const { getByTestId } = render(<SidebarDom toggleRail={toggleRail} />);
      click(getByTestId(id));
      expect(toggleRail).not.toHaveBeenCalled();
      click(getByTestId("section"));
      expect(toggleRail).toHaveBeenCalledTimes(1);
    },
  );

  it("does not toggle at the end of a text-selection drag inside the nav", () => {
    const toggleRail = vi.fn();
    const { getByTestId } = render(<SidebarDom toggleRail={toggleRail} />);
    const range = document.createRange();
    range.selectNodeContents(getByTestId("label"));
    document.getSelection()?.addRange(range);
    click(getByTestId("section"));
    expect(toggleRail).not.toHaveBeenCalled();
  });

  it("does not toggle at the end of a pointer drag across blank space", () => {
    const toggleRail = vi.fn();
    const { getByTestId } = render(<SidebarDom toggleRail={toggleRail} />);
    const section = getByTestId("section");
    section.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
    click(section, { clientX: 40, clientY: 12 });
    expect(toggleRail).not.toHaveBeenCalled();
  });

  it("still toggles when the pointer wobbles within the drag threshold", () => {
    const toggleRail = vi.fn();
    const { getByTestId } = render(<SidebarDom toggleRail={toggleRail} />);
    const section = getByTestId("section");
    section.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
    click(section, { clientX: 13, clientY: 7 });
    expect(toggleRail).toHaveBeenCalledTimes(1);
  });

  it("does not toggle on a non-primary button or an already-handled click", () => {
    const toggleRail = vi.fn();
    const { getByTestId } = render(<SidebarDom toggleRail={toggleRail} />);
    click(getByTestId("nav"), { button: 1 });
    const section = getByTestId("section");
    section.addEventListener("click", (e) => e.preventDefault(), { once: true });
    click(section);
    expect(toggleRail).not.toHaveBeenCalled();
  });

  it("removes its listener on unmount", () => {
    const toggleRail = vi.fn();
    const nav = document.createElement("nav");
    nav.id = "admin-sidebar";
    document.body.appendChild(nav);
    const { unmount } = render(<Wiring toggleRail={toggleRail} />);
    unmount();
    click(nav);
    expect(toggleRail).not.toHaveBeenCalled();
  });

  it("is inert when no sidebar nav is mounted", () => {
    const toggleRail = vi.fn();
    expect(() => render(<Wiring toggleRail={toggleRail} />)).not.toThrow();
  });
});

describe("isEmptySidebarClick", () => {
  it("rejects a target outside the nav and a non-element target", () => {
    const nav = document.createElement("nav");
    const outside = document.createElement("div");
    expect(isEmptySidebarClick({ target: outside, button: 0, defaultPrevented: false }, { nav, selectingText: false, dragged: false })).toBe(false);
    expect(isEmptySidebarClick({ target: null, button: 0, defaultPrevented: false }, { nav, selectingText: false, dragged: false })).toBe(false);
  });

  it("treats a control that WRAPS the nav as outside it (only controls inside the nav count)", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("tabindex", "-1");
    const nav = document.createElement("nav");
    wrapper.appendChild(nav);
    expect(isEmptySidebarClick({ target: nav, button: 0, defaultPrevented: false }, { nav, selectingText: false, dragged: false })).toBe(true);
  });
});

it("uses the live default desktop media query and stops toggling below the rail breakpoint", () => {
  const query = "(min-width: 901px)";
  let desktop = false;
  const previous = Object.getOwnPropertyDescriptor(window, "matchMedia");
  const matchMedia = vi.fn((media: string) => ({ media, matches: media === query && desktop }));
  Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
  function DefaultWiring({ toggleRail }: { toggleRail: () => void }) {
    useSidebarEmptyClickToggle({ toggleRail });
    return <nav id="admin-sidebar" aria-label="Rail" />;
  }
  try {
    const toggleRail = vi.fn();
    const { getByRole, unmount } = render(<DefaultWiring toggleRail={toggleRail} />);
    const nav = getByRole("navigation", { name: "Rail" });
    click(nav);
    expect(toggleRail).not.toHaveBeenCalled();
    desktop = true;
    click(nav);
    expect(toggleRail).toHaveBeenCalledOnce();
    expect(matchMedia.mock.calls).toEqual([[query], [query]]);
    unmount();
    click(nav);
    expect(toggleRail).toHaveBeenCalledOnce();
  } finally {
    if (previous) Object.defineProperty(window, "matchMedia", previous);
    else Reflect.deleteProperty(window, "matchMedia");
  }
});
