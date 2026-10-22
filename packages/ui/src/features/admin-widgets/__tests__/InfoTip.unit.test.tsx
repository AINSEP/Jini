import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { InfoTip } from "../components/InfoTip.js";
import type { InfoTipController } from "../components/InfoTip.hooks";

/**
 * @file `InfoTip`'s open/close behavior — the reason this component exists instead of the native
 * `title` attribute (see its own doc comment): it must be reachable and dismissible without a mouse.
 * First real caller is `ThemeExplore.tsx`'s collapsed "you're editing your own copy" line
 * (2026-08-11); this file covers the shared component directly rather than through that caller so
 * the behavior stays covered even if a future caller changes how it's used.
 *
 * The bubble portals into `document.body` (see the component's own doc for why), so assertions on
 * its content use `screen` rather than a container returned by `render`.
 */
describe("InfoTip", () => {
  const LABEL = "An untouched original is kept separately.";

  it("keeps inline help in its label row and supports focus and Escape without an overlay", async () => {
    const user = userEvent.setup();
    const { container } = render(<div className="label-row"><InfoTip label={LABEL} placement="inline" /></div>);
    await user.tab();
    const copy = screen.getByText(LABEL);
    expect(container.querySelector('.label-row')).toContainElement(copy);
    expect(copy).toHaveClass('info-tip-inline-copy');
    expect(document.querySelector('.info-tip-bubble')).toBeNull();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveFocus();
  });

  it("shows a caller's icon instead of the default glyph, still named and still opening the bubble", () => {
    render(<InfoTip label={LABEL} triggerLabel="Subagents" icon={<svg data-testid="custom-icon" />} placement="bottom" />);
    const trigger = screen.getByRole("button", { name: "Subagents" });
    expect(trigger).toContainElement(screen.getByTestId("custom-icon"));
    expect(trigger).not.toHaveTextContent("ⓘ");
    expect(trigger).toHaveClass("info-tip-icon--custom");
    fireEvent.mouseEnter(trigger);
    expect(screen.getByText(LABEL, { selector: ".info-tip-bubble" })).toBeInTheDocument();
  });

  it("is closed by default, with the icon reachable by its accessible name", () => {
    render(<InfoTip label={LABEL} />);
    expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
    expect(screen.getByLabelText(LABEL)).toBeInTheDocument();
  });

  it("opens on focus — the keyboard-only path, since this is deliberately not the native title attribute", async () => {
    const user = userEvent.setup();
    render(<InfoTip label={LABEL} />);
    await user.tab();
    expect(screen.getByText(LABEL)).toBeInTheDocument();
  });

  it("closes on blur (tabbing away)", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <InfoTip label={LABEL} />
        <button type="button">next</button>
      </div>
    );
    await user.tab();
    expect(screen.getByText(LABEL)).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
  });

  it("opens on hover and closes on unhover", async () => {
    const user = userEvent.setup();
    render(<InfoTip label={LABEL} />);
    const icon = screen.getByLabelText(LABEL);
    await user.hover(icon);
    expect(screen.getByText(LABEL)).toBeInTheDocument();
    await user.unhover(icon);
    expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
  });

  it("closes on Escape without moving focus off the icon", async () => {
    const user = userEvent.setup();
    render(<InfoTip label={LABEL} />);
    const icon = screen.getByLabelText(LABEL);
    await user.tab();
    expect(screen.getByText(LABEL)).toBeInTheDocument();
    expect(document.activeElement).toBe(icon);

    await user.keyboard("{Escape}");
    expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
    // Escape dismisses in place — it must not also blur the icon, unlike Tab/Shift+Tab above.
    expect(document.activeElement).toBe(icon);
  });

  it("Escape is a no-op when the bubble is already closed", () => {
    render(<InfoTip label={LABEL} />);
    const icon = screen.getByLabelText(LABEL);
    // `fireEvent` dispatches directly on the icon regardless of real DOM focus, isolating the
    // `open` guard in `handleIconKeyDown` from the focus-driven `show()`/`hide()` calls the other
    // tests already cover — this is the one path where the icon receives Escape while `open` is
    // still false, e.g. a keydown that fires before `onFocus` has resolved.
    expect(() => fireEvent.keyDown(icon, { key: "Escape" })).not.toThrow();
    expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
  });

  /**
   * Placement flip — added after a live check on ThemeExplore.tsx's actual usage (the icon sits
   * ~74px below the viewport top there) showed the default "open above" rendering the bubble with a
   * negative `top`, clipped against the browser window itself. jsdom never lays anything out, so
   * `getBoundingClientRect` always returns an all-zero rect unless a test stubs it — these two cases
   * stub it explicitly to drive both sides of the `ABOVE_HEADROOM_PX` branch, rather than relying on
   * jsdom's default (which happens to already exercise "below", making that branch look covered by
   * accident even in a test that isn't asserting placement at all).
   */
  it("opens below the icon when there isn't enough room above it", async () => {
    const user = userEvent.setup();
    render(<InfoTip label={LABEL} />);
    const icon = screen.getByLabelText(LABEL);
    icon.getBoundingClientRect = () =>
      ({ top: 40, bottom: 60, left: 100, right: 120, width: 20, height: 20 }) as DOMRect;

    await user.tab();
    expect(screen.getByText(LABEL)).toHaveClass("info-tip-bubble-below");
  });

  it("opens above the icon when there is enough room above it", async () => {
    const user = userEvent.setup();
    render(<InfoTip label={LABEL} />);
    const icon = screen.getByLabelText(LABEL);
    icon.getBoundingClientRect = () =>
      ({ top: 400, bottom: 420, left: 100, right: 120, width: 20, height: 20 }) as DOMRect;

    await user.tab();
    const bubble = screen.getByText(LABEL);
    expect(bubble).toHaveClass("info-tip-bubble");
    expect(bubble).not.toHaveClass("info-tip-bubble-below");
  });
});

/**
 * Tap-to-pin (2026-10-09, AI Assistant redesign): explainers moved off the page into InfoTips, so
 * the tip must be readable on a phone, where there is no hover to hold it open.
 */
describe("InfoTip tap and description wiring", () => {
  const LABEL = "Off by default. Applies to new runs only.";

  it("a click pins the tip open past the pointer leaving; a second click closes it", async () => {
    const user = userEvent.setup();
    render(<InfoTip label={LABEL} triggerLabel="About subagents" />);
    const icon = screen.getByRole("button", { name: "About subagents" });
    await user.click(icon);
    expect(icon).toHaveAttribute("aria-expanded", "true");
    await user.unhover(icon);
    expect(icon).toHaveAttribute("aria-expanded", "true");
    await user.click(icon);
    expect(icon).toHaveAttribute("aria-expanded", "false");
  });

  it("a tap outside closes a pinned tip", async () => {
    const user = userEvent.setup();
    render(<div><InfoTip label={LABEL} triggerLabel="About subagents" /><p>elsewhere</p></div>);
    const icon = screen.getByRole("button", { name: "About subagents" });
    await user.click(icon);
    await user.click(screen.getByText("elsewhere"));
    expect(icon).toHaveAttribute("aria-expanded", "false");
  });

  it("Enter toggles like a button for keyboard users", async () => {
    const user = userEvent.setup();
    render(<InfoTip label={LABEL} triggerLabel="About subagents" />);
    const icon = screen.getByRole("button", { name: "About subagents" });
    await user.tab();
    await user.keyboard("{Enter}");
    await user.unhover(icon);
    expect(icon).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Enter}");
    expect(icon).toHaveAttribute("aria-expanded", "false");
  });

  it("with a short name, the full text is the icon's description and can describe another control", () => {
    render(<><input type="checkbox" aria-label="Allow subagents" aria-describedby="tip-text" />
      <InfoTip label={LABEL} triggerLabel="About subagents" descriptionId="tip-text" /></>);
    expect(screen.getByRole("button", { name: "About subagents" })).toHaveAccessibleDescription(LABEL);
    expect(screen.getByRole("checkbox", { name: "Allow subagents" })).toHaveAccessibleDescription(LABEL);
  });

  it("without a short name, the icon keeps the full text as its name and gets no duplicate description", () => {
    render(<InfoTip label={LABEL} />);
    expect(screen.getByRole("button", { name: LABEL })).not.toHaveAttribute("aria-describedby");
  });
});

describe("InfoTip tip-hook injection", () => {
  const LABEL = "An untouched original is kept separately.";

  it("forwards the host placement to its hook while retaining the explanation as a description", () => {
    let requested: string | undefined;
    const useTip: typeof import('../components/InfoTip.hooks.js').useInfoTip = (_input, options) => {
      requested = options?.placement;
      return { open: false, placement: 'above', coords: { top: 0, left: 0 }, iconRef: { current: null },
        show() {}, hide() {}, leave() {}, toggle() {}, handleIconKeyDown() {} };
    };
    render(<InfoTip label={LABEL} triggerLabel="About folders" placement="top" useTip={useTip} />);
    expect(requested).toBe('top');
    expect(screen.getByRole('button', { name: 'About folders' })).toHaveAccessibleDescription(LABEL);
  });

  it("renders purely off an injected fake, proving useInfoTip is not hardcoded", () => {
    // The real `useInfoTip` always starts `open: false` — a first render can never show the
    // bubble without a hover/focus interaction first. A fake that starts already-open is
    // something the real hook could never produce on mount, so this only passes if `InfoTip`
    // actually rendered off the fake.
    function useFakeInfoTip(): InfoTipController {
      return {
        open: true,
        placement: "below",
        coords: { top: 12, left: 34 },
        iconRef: { current: null },
        show: () => {},
        hide: () => {},
        leave: () => {},
        toggle: () => {},
        handleIconKeyDown: () => {},
      };
    }

    render(<InfoTip label={LABEL} useTip={useFakeInfoTip} />);

    const bubble = screen.getByText(LABEL);
    expect(bubble).toHaveClass("info-tip-bubble-below");
    expect(bubble).toHaveStyle({ top: "12px", left: "34px" });
  });

  it("shows \"• \" lines as a hanging list, the bullet beside its text", async () => {
    render(<InfoTip label={"• Show: every call.\n• Hidden: failed calls only."} />);
    await userEvent.setup().hover(screen.getByRole("button"));
    const bullets = [...document.querySelectorAll(".info-tip-bubble .info-tip-bullet")];
    expect(bullets.map((line) => [...line.children].map((part) => part.textContent))).toEqual([
      ["•", "Show: every call."], ["•", "Hidden: failed calls only."],
    ]);
  });

  it("publishes an agent handle on the icon with button semantics and the icon's name", () => {
    render(<InfoTip label={LABEL} triggerLabel="About folders" agentHandle="folder-tip" />);
    const icon = screen.getByRole("button", { name: "About folders" });
    expect(icon).toHaveAttribute("data-agent-element", "folder-tip");
    expect(icon).toHaveAttribute("data-agent-role", "button");
    expect(icon).toHaveAttribute("data-agent-label", "About folders");
  });

  it("refuses an invalid agent handle with the handle and the rule it broke", () => {
    expect(() => render(<InfoTip label={LABEL} agentHandle="Bad Handle" />)).toThrow(
      'invalid element handle "Bad Handle": handles are lowercase words joined by single hyphens, and are never CSS selectors',
    );
  });

  it("without an agent handle the icon carries no agent attributes", () => {
    render(<InfoTip label={LABEL} />);
    expect(screen.getByRole("button").getAttributeNames().filter((name) => name.startsWith("data-agent"))).toEqual([]);
  });

  it("a bulleted label keeps its plain lines as lines, separated by newlines except after the last", async () => {
    render(<InfoTip label={"Pick one:\n• Show: all.\nThen save."} />);
    await userEvent.setup().hover(screen.getByRole("button"));
    const bubble = document.querySelector(".info-tip-bubble");
    expect([...bubble!.children].map((line) => [line.className, line.textContent])).toEqual([
      ["info-tip-line", "Pick one:\n"], ["info-tip-bullet", "• Show: all.\n"], ["info-tip-line", "Then save."],
    ]);
  });

  it("inside a modal dialog the bubble portals into that dialog, not body", async () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.appendChild(dialog);
    render(<InfoTip label={LABEL} />, { container: dialog });
    await userEvent.setup().hover(screen.getByRole("button"));
    expect(document.querySelector(".info-tip-bubble")?.parentElement).toBe(dialog);
    dialog.remove();
  });

  it("closed inline help shows no copy of its label beside the icon", () => {
    const { container } = render(<InfoTip label={LABEL} placement="inline" />);
    expect(container.querySelector(".info-tip-inline-copy")).toBeNull();
  });

  it("without a short name, a caller's descriptionId still gets the hidden copy but the icon is not described by it", () => {
    render(<InfoTip label={LABEL} descriptionId="field-help" />);
    expect(document.getElementById("field-help")).toHaveTextContent(LABEL);
    expect(screen.getByRole("button", { name: LABEL })).not.toHaveAttribute("aria-describedby");
  });
});
