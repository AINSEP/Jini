import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveSeeMoreView, SeeMore } from "../components/SeeMore/SeeMore";
import type { useSeeMoreClamp } from "../components/SeeMore/SeeMore.hooks";

/**
 * @file `SeeMore` — the line-clamped block with a "See more" / "See less" toggle.
 *
 * jsdom has no layout engine: `scrollHeight` and `clientHeight` are both hard 0, so the component's
 * own overflow check reports "fits" for every string and the toggle would never render in any test
 * here. `stubLayout` below installs the smallest honest model of the real thing — the clamped
 * element is taller than its box, the expanded one is not — because that difference is precisely
 * what the component keys off, and getting it backwards is the strand-the-user bug this suite's
 * fourth test pins. Nothing here can vouch for the CSS actually clamping; that is a browser
 * measurement (see the handoff's "jsdom certified a visibly broken dialog" finding), and this
 * suite covers the behavior contract only.
 *
 * `useSeeMoreClamp` itself (rounding, overflow measurement, the expand/collapse state machine) has
 * its own suite in `SeeMore.hooks.unit.test.tsx`, driven directly with `renderHook` — split out of
 * this file the same way the component and hook themselves were split, per the `SeeMore`/
 * `SeeMore.hooks` refactor. What stays here is only what needs a real render: DOM output, ARIA
 * wiring, and the `useClamp` injection seam below.
 */

const CLAMPED_BOX_HEIGHT = 40;
const FULL_TEXT_HEIGHT = 120;

const LONG_TEXT =
  "Add CSS classes and HTML attributes to this field's input. Classes are unrestricted, and " +
  "attribute names are limited to a safe allowlist — anything else is rejected.";

let originalScrollHeight: PropertyDescriptor | undefined;
let originalClientHeight: PropertyDescriptor | undefined;

/**
 * @param overflowing when false, content is exactly its box height — the "short string, no toggle"
 * case. When true, clamped content overflows and expanded content does not, mirroring what a real
 * engine reports once `-webkit-line-clamp` is lifted.
 */
function stubLayout(overflowing: boolean) {
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get() {
      return CLAMPED_BOX_HEIGHT;
    },
  });
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get(this: Element) {
      if (!overflowing) return CLAMPED_BOX_HEIGHT;
      return this.classList.contains("is-expanded") ? CLAMPED_BOX_HEIGHT : FULL_TEXT_HEIGHT;
    },
  });
}

beforeEach(() => {
  originalScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
  originalClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
});

afterEach(() => {
  if (originalScrollHeight) Object.defineProperty(Element.prototype, "scrollHeight", originalScrollHeight);
  if (originalClientHeight) Object.defineProperty(Element.prototype, "clientHeight", originalClientHeight);
});

describe("SeeMore", () => {
  it("renders collapsed with the full text still in the DOM", async () => {
    stubLayout(true);
    const { container } = render(<SeeMore>{LONG_TEXT}</SeeMore>);

    const region = container.querySelector(".see-more-text");
    // The point of clamping over conditional rendering: every word is present and findable even
    // while visually cut off. A substring-based implementation would pass nothing but this.
    expect(region).toHaveTextContent(LONG_TEXT);
    expect(region).not.toHaveClass("is-expanded");
    expect(screen.getByRole("button", { name: "See more" })).toHaveAttribute("aria-expanded", "false");
  });

  it("renders no toggle at all when the text fits within the clamp", () => {
    stubLayout(false);
    render(<SeeMore>Short.</SeeMore>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("expands and collapses, swapping the label and aria-expanded", async () => {
    const user = userEvent.setup();
    stubLayout(true);
    const { container } = render(<SeeMore>{LONG_TEXT}</SeeMore>);
    const region = container.querySelector(".see-more-text");

    await user.click(screen.getByRole("button", { name: "See more" }));
    expect(region).toHaveClass("is-expanded");
    expect(screen.getByRole("button", { name: "See less" })).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "See less" }));
    expect(region).not.toHaveClass("is-expanded");
    expect(screen.getByRole("button", { name: "See more" })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the toggle mounted while expanded", async () => {
    const user = userEvent.setup();
    stubLayout(true);
    render(<SeeMore>{LONG_TEXT}</SeeMore>);

    await user.click(screen.getByRole("button", { name: "See more" }));

    // The regression this pins: expanding removes the clamp, so a re-measure while expanded reports
    // "does not overflow" and would unmount the only control that can collapse it again. The
    // component skips measuring while expanded precisely to prevent that. Without the skip, this
    // assertion fails and the user is stuck reading six lines forever.
    expect(screen.getByRole("button", { name: "See less" })).toBeInTheDocument();
  });

  it("points aria-controls at the clamped region's own id", () => {
    stubLayout(true);
    const { container } = render(<SeeMore>{LONG_TEXT}</SeeMore>);

    const region = container.querySelector(".see-more-text");
    const controlled = screen.getByRole("button").getAttribute("aria-controls");
    expect(controlled).toBeTruthy();
    expect(region?.id).toBe(controlled);
  });

  it("drives the clamp line count from the prop, not a class per N", () => {
    stubLayout(true);
    for (const lines of [1, 2, 3]) {
      const { container, unmount } = render(<SeeMore lines={lines}>{LONG_TEXT}</SeeMore>);
      const region = container.querySelector<HTMLElement>(".see-more-text");
      expect(region?.style.getPropertyValue("--see-more-lines")).toBe(String(lines));
      unmount();
    }
  });

  it("defaults to two lines and raises a below-1 value to 1", () => {
    stubLayout(true);
    const { container, unmount } = render(<SeeMore>{LONG_TEXT}</SeeMore>);
    expect(container.querySelector<HTMLElement>(".see-more-text")?.style.getPropertyValue("--see-more-lines")).toBe("2");
    unmount();

    const { container: zero } = render(<SeeMore lines={0}>{LONG_TEXT}</SeeMore>);
    expect(zero.querySelector<HTMLElement>(".see-more-text")?.style.getPropertyValue("--see-more-lines")).toBe("1");
  });

  it("applies caller styling classes without dropping its own", () => {
    stubLayout(true);
    const { container } = render(
      <SeeMore className="host-wrap" textClassName="field-attrs-hint" toggleClassName="host-toggle">
        {LONG_TEXT}
      </SeeMore>
    );

    expect(container.querySelector(".see-more")).toHaveClass("host-wrap");
    // `field-attrs-hint` is what carries the caller's typography; `see-more-text` is what carries
    // the clamp. Both must survive — dropping either is a silent visual regression.
    expect(container.querySelector(".see-more-text")).toHaveClass("field-attrs-hint");
    expect(screen.getByRole("button")).toHaveClass("see-more-toggle", "host-toggle");
  });

  it("accepts custom toggle labels and an explicit accessible name", async () => {
    const user = userEvent.setup();
    stubLayout(true);
    render(
      <SeeMore moreLabel="Show details" lessLabel="Hide details" toggleAriaLabel="Toggle attribute help">
        {LONG_TEXT}
      </SeeMore>
    );

    // `aria-label` wins over the visible text for the accessible name, which is the whole reason
    // the prop exists: several "See more" buttons on one screen are indistinguishable in a screen
    // reader's button list.
    const toggle = screen.getByRole("button", { name: "Toggle attribute help" });
    expect(toggle).toHaveTextContent("Show details");

    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Toggle attribute help" })).toHaveTextContent("Hide details");
  });

  it("renders element children, not just strings", () => {
    stubLayout(true);
    const { container } = render(
      <SeeMore>
        Use <code>md:col-span-2</code> here.
      </SeeMore>
    );
    expect(container.querySelector(".see-more-text code")).toHaveTextContent("md:col-span-2");
  });
});

describe("SeeMore hook injection", () => {
  it("renders entirely off an injected useClamp — the real useSeeMoreClamp is never called", () => {
    // A fake that always reports expanded+overflowing, independent of any real measurement — if
    // this test passed with the real hook wired in instead (no DOM layout stubbed), it would prove
    // nothing about injection actually working. Asserting `expanded`/label state that the real hook
    // could not produce under jsdom's zero-layout defaults is what proves the seam is live.
    const fakeUseClamp: typeof useSeeMoreClamp = () => ({
      expanded: true,
      setExpanded: () => {},
      overflows: true,
      textRef: { current: null },
      regionId: "fake-region-id",
      lineCount: 2,
    });

    render(
      <SeeMore useClamp={fakeUseClamp}>{LONG_TEXT}</SeeMore>
    );

    // Expanded + labeled "See less", with the fake's own regionId — none of this is reachable
    // under jsdom's real useSeeMoreClamp without stubLayout(true) AND a click, which this test
    // never does.
    const toggle = screen.getByRole("button", { name: "See less" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "fake-region-id");
  });
});

describe("resolveSeeMoreView", () => {
  // Direct coverage of the pure function extracted out of `SeeMore`'s own render body — the
  // rendered-component tests above already pin the same behavior end-to-end (a `className` prop
  // shows up on the wrapper, `moreLabel`/`lessLabel` show up on the toggle, etc.); this exercises
  // its branch combinations without a render at all.
  it("defaults every className to its bare form and the label to moreLabel when collapsed", () => {
    expect(resolveSeeMoreView({ expanded: false })).toEqual({
      wrapperClassName: "see-more",
      textClassName: "see-more-text",
      toggleClassName: "see-more-toggle",
      toggleLabel: "See more",
    });
  });

  it("appends a caller class to each className, alongside the fixed one, and switches the label when expanded", () => {
    expect(
      resolveSeeMoreView({ expanded: true }, { className: "host", textClassName: "host-text", toggleClassName: "host-toggle" })
    ).toEqual({
      wrapperClassName: "see-more host",
      textClassName: "see-more-text is-expanded host-text",
      toggleClassName: "see-more-toggle host-toggle",
      toggleLabel: "See less",
    });
  });

  it("honors custom moreLabel/lessLabel over the defaults", () => {
    const collapsed = resolveSeeMoreView({ expanded: false }, { moreLabel: "Show details", lessLabel: "Hide details" });
    const expanded = resolveSeeMoreView({ expanded: true }, { moreLabel: "Show details", lessLabel: "Hide details" });
    expect(collapsed.toggleLabel).toBe("Show details");
    expect(expanded.toggleLabel).toBe("Hide details");
  });
});
