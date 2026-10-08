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

describe("InfoTip tip-hook injection", () => {
  const LABEL = "An untouched original is kept separately.";

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
        handleIconKeyDown: () => {},
      };
    }

    render(<InfoTip label={LABEL} useTip={useFakeInfoTip} />);

    const bubble = screen.getByText(LABEL);
    expect(bubble).toHaveClass("info-tip-bubble-below");
    expect(bubble).toHaveStyle({ top: "12px", left: "34px" });
  });
});
