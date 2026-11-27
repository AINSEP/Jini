// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CapabilityList, DisclosureChevron, FullSiteIcon, HistoryIcon, LayersIcon, OverviewIcon, StaticSiteIcon, StepDoneIcon } from "../deployment-visuals.js";

afterEach(cleanup);

const lineIcon = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

it.each([
  ["overview", OverviewIcon], ["static site", StaticSiteIcon], ["full site", FullSiteIcon],
  ["history", HistoryIcon], ["Dockerfile", LayersIcon],
] as const)("%s glyph stays decorative at either its default or explicit size", (_label, Glyph) => {
  const { container, rerender } = render(<button>Open panel<Glyph lineIcon={lineIcon} /></button>);
  expect(screen.getByRole("button", { name: "Open panel" })).toBe(container.firstElementChild);
  expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(container.querySelector("svg")?.getAttribute("width")).toBe("20");
  rerender(<button>Open panel<Glyph lineIcon={lineIcon} size={26} /></button>);
  expect(container.querySelector("svg")?.getAttribute("width")).toBe("26");
  expect(container.querySelector("svg")?.getAttribute("height")).toBe("26");
});

it("uses different glyphs and accessible names for supported and unsupported capabilities", () => {
  render(<CapabilityList lineIcon={lineIcon} t={key => `localized ${key}`} rows={[
    { id: "pages", labelKey: "Pages", supported: true },
    { id: "checkout", labelKey: "Checkout", supported: false },
  ]} />);
  const row = (text: string) => screen.getByText(text).closest("li")!;
  const yes = within(row("localized Pages")).getByRole("img", { name: "localized Supported" });
  const no = within(row("localized Checkout")).getByRole("img", { name: "localized Not supported" });
  expect(yes.querySelector("path")?.getAttribute("d")).toBe("m5 13 4.5 4.5L19 6.5");
  expect(no.querySelector("path")?.getAttribute("d")).toBe("M6 6l12 12M18 6L6 18");
});

it("uses the check and disclosure chevron as separate decorative glyphs", () => {
  function Icon({ name, size, ...rest }: ComponentProps<Parameters<typeof StepDoneIcon>[0]["Icon"]>) {
    return <svg {...rest} data-icon={name} width={size} />;
  }
  const { container, rerender } = render(<><StepDoneIcon lineIcon={lineIcon} Icon={Icon} /><DisclosureChevron lineIcon={lineIcon} Icon={Icon} /></>);
  expect(container.querySelector('[data-icon="check-long"]')?.getAttribute("width")).toBe("12");
  expect(container.querySelector('[data-icon="check-long"]')?.getAttribute("aria-hidden")).toBe("true");
  expect(container.querySelector('[data-icon="chevron-down"]')?.getAttribute("width")).toBe("14");
  expect(container.querySelector('[data-icon="chevron-down"]')?.getAttribute("aria-hidden")).toBe("true");
  rerender(<><StepDoneIcon lineIcon={lineIcon} Icon={Icon} size={18} /><DisclosureChevron lineIcon={lineIcon} Icon={Icon} size={22} /></>);
  expect(container.querySelector('[data-icon="check-long"]')?.getAttribute("width")).toBe("18");
  expect(container.querySelector('[data-icon="chevron-down"]')?.getAttribute("width")).toBe("22");
});
