// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEVICE_PREVIEW_ICONS } from "../device-preview-icons.js";

describe("device preview icon association", () => {
  // F1.3/F1.5: swapping tablet/mobile must fail. This verifies emitted vector geometry,
  // not CSS layout or a screenshot; literal glyph dimensions are independent expectations.
  it.each([
    ["desktop", "3", "4", "18", "12", "1.5", "M2 19h20"],
    ["tablet", "4", "3", "16", "18", "2", "M11 18h2"],
    ["mobile", "7", "2", "10", "20", "2", "M11 18h2"],
  ] as const)("emits the %s glyph with decorative, unfocusable SVG attributes", (device, x, y, width, height, rx, path) => {
    const Icon = DEVICE_PREVIEW_ICONS[device];
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("width", "16");
    expect(svg).toHaveAttribute("height", "16");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("fill", "none");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("stroke-width", "1.5");
    const rect = svg.querySelector("rect")!;
    expect(rect).toHaveAttribute("x", x);
    expect(rect).toHaveAttribute("y", y);
    expect(rect).toHaveAttribute("width", width);
    expect(rect).toHaveAttribute("height", height);
    expect(rect).toHaveAttribute("rx", rx);
    expect(svg.querySelector("path")).toHaveAttribute("d", path);
  });
});
