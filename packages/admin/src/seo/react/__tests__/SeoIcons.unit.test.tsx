import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeoDefaultsIcon, SeoEntriesIcon, SeoSitemapIcon } from "../components/SeoIcons.js";

/** The SEO tab icons are decoration beside a visible label: each must stay hidden from assistive
 *  technology, share the line-icon family attributes, and keep its own glyph so tabs stay distinct. */
describe("SEO tab icons", () => {
  it.each([
    ["defaults", SeoDefaultsIcon, "M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4", 3, 0],
    ["sitemap", SeoSitemapIcon, "M12 7v4M6 17v-2h12v2M12 11v4", 0, 3],
    ["entries", SeoEntriesIcon, "M10 12h5M10 16h3", 0, 0],
  ] as const)("renders the %s glyph as a decorative 16px line icon by default", (_name, Icon, lastPath, circles, rects) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("fill", "none");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("stroke-width", "1.5");
    expect(svg).toHaveAttribute("stroke-linecap", "round");
    expect(svg).toHaveAttribute("stroke-linejoin", "round");
    expect(svg).toHaveAttribute("width", "16");
    expect(svg).toHaveAttribute("height", "16");
    const paths = [...svg.querySelectorAll("path")].map((path) => path.getAttribute("d"));
    expect(paths.at(-1)).toBe(lastPath);
    expect(svg.querySelectorAll("circle")).toHaveLength(circles);
    expect(svg.querySelectorAll("rect")).toHaveLength(rects);
  });

  it.each([
    ["defaults", SeoDefaultsIcon],
    ["sitemap", SeoSitemapIcon],
    ["entries", SeoEntriesIcon],
  ] as const)("sizes the %s glyph from the size prop", (_name, Icon) => {
    const { container } = render(<Icon size={24} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("width", "24");
    expect(svg).toHaveAttribute("height", "24");
  });
});
