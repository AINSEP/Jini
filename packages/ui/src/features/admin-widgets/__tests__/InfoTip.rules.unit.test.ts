import { describe, expect, it } from "vitest";

import { infoTipBubbleStyle, placeInfoTipBubble } from "../components/InfoTip.rules";

/** A 24px icon at a given left/top, as `getBoundingClientRect()` reports it. */
const icon = (left: number, top = 400) => ({ left, top, width: 24, height: 24 });
const viewport = { width: 1280, height: 800 };

describe("placeInfoTipBubble", () => {
  it("centres a bubble on its icon when it fits, with the arrow at the bubble's centre", () => {
    const placed = placeInfoTipBubble({ anchor: icon(600), bubble: { width: 80, height: 30 }, viewport });
    expect(placed).toEqual({ placement: "above", top: 400, left: 612, arrowLeft: 40 });
  });

  it("right edge: shifts a short bubble left by its REAL width only, keeping the arrow on the icon", () => {
    // The widget editor's ↑ ↓ ✕ near the right edge (Chrome re-check, 2026-10-11): one shared
    // max-width clamp gave all three the same left; each must stay under its own button.
    const lefts = [1190, 1216, 1242].map((x) => placeInfoTipBubble({ anchor: icon(x), bubble: { width: 60, height: 30 }, viewport }).left);
    expect(lefts).toEqual([1202, 1228, 1242]);
    const remove = placeInfoTipBubble({ anchor: icon(1242), bubble: { width: 60, height: 30 }, viewport });
    expect(remove.left + 30).toBe(viewport.width - 8);
    // The arrow points at the ✕'s centre (1254), measured from the bubble's left edge (1212).
    expect(remove.arrowLeft).toBe(42);
  });

  it("right edge: a wide bubble keeps its full width and shifts instead of squeezing", () => {
    const placed = placeInfoTipBubble({ anchor: icon(1250), bubble: { width: 288, height: 60 }, viewport });
    expect(placed.left).toBe(1280 - 8 - 144);
    expect(placed.arrowLeft).toBe(288 - 10);
  });

  it("left edge: shifts right by the measured width", () => {
    const placed = placeInfoTipBubble({ anchor: icon(0), bubble: { width: 100, height: 30 }, viewport });
    expect(placed.left).toBe(58);
    // The icon's centre (12) is 4px into the bubble; the arrow stops clear of the rounded corner.
    expect(placed.arrowLeft).toBe(10);
  });

  it("narrow viewport: a bubble wider than the usable span centres in the viewport", () => {
    const placed = placeInfoTipBubble({ anchor: icon(10), bubble: { width: 300, height: 60 }, viewport: { width: 280, height: 600 } });
    expect(placed.left).toBe(140);
  });

  it("375px viewport: a max-width bubble fits by shifting", () => {
    const placed = placeInfoTipBubble({ anchor: icon(340), bubble: { width: 288, height: 60 }, viewport: { width: 375, height: 700 } });
    expect(placed.left).toBe(375 - 8 - 144);
  });

  it("before measurement, assumes the worst-case 18rem width", () => {
    expect(placeInfoTipBubble({ anchor: icon(1000), bubble: null, viewport: { width: 1024, height: 768 } }).left).toBe(872);
  });

  it("stays inside host bounds (the assistant dock) when the bubble fits there", () => {
    const bounds = { left: 880, right: 1280 };
    const placed = placeInfoTipBubble({ anchor: icon(884), bubble: { width: 200, height: 30 }, viewport }, { bounds });
    expect(placed.left).toBe(880 + 8 + 100);
  });

  it("ignores bounds too narrow for the bubble and fits the viewport instead", () => {
    const bounds = { left: 1100, right: 1280 };
    const placed = placeInfoTipBubble({ anchor: icon(1104), bubble: { width: 200, height: 30 }, viewport }, { bounds });
    expect(placed.left).toBe(1116);
  });

  it("falls below without measured headroom, and opens above once the real height fits", () => {
    expect(placeInfoTipBubble({ anchor: icon(600, 100), bubble: null, viewport }).placement).toBe("below");
    expect(placeInfoTipBubble({ anchor: icon(600, 100), bubble: { width: 80, height: 40 }, viewport }).placement).toBe("above");
    const below = placeInfoTipBubble({ anchor: icon(600, 20), bubble: { width: 80, height: 40 }, viewport });
    expect(below).toMatchObject({ placement: "below", top: 44 });
  });

  it("a bottom preference flips above only when it would overflow the viewport and fits above", () => {
    expect(placeInfoTipBubble({ anchor: icon(600, 400), bubble: { width: 80, height: 40 }, viewport }, { preferred: "bottom" }).placement).toBe("below");
    expect(placeInfoTipBubble({ anchor: icon(600, 760), bubble: { width: 80, height: 40 }, viewport }, { preferred: "bottom" }).placement).toBe("above");
    expect(placeInfoTipBubble({ anchor: icon(600, 760), bubble: null, viewport }, { preferred: "bottom" }).placement).toBe("below");
  });
});

describe("infoTipBubbleStyle", () => {
  it("passes position through and sets the arrow variable only once measured", () => {
    expect(infoTipBubbleStyle({ top: 1, left: 2 })).toEqual({ top: 1, left: 2 });
    expect(infoTipBubbleStyle({ top: 1, left: 2, arrowLeft: 30 })).toEqual({ top: 1, left: 2, "--info-tip-arrow-left": "30px" });
  });
});
