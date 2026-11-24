// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { CheckIcon, ChevronIcon, CopyIcon, GaugeIcon, PulseIcon, QueriesIcon } from "../observability-visuals.js";

it.each([["pulse", PulseIcon], ["gauge", GaugeIcon], ["queries", QueriesIcon]] as const)("%s emits decorative SVG with default and requested dimensions", (_name, Icon) => {
  // F4.3 regression target: hardcode width/height to 16, or drop aria-hidden. This checks emitted markup, not layout (F1.5).
  const view = render(<Icon />);
  const svg = view.container.querySelector("svg")!;
  expect(svg).toHaveAttribute("width", "16");
  expect(svg).toHaveAttribute("height", "16");
  expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
  expect(svg).toHaveAttribute("aria-hidden", "true");
  view.rerender(<Icon size={31} />);
  expect(svg).toHaveAttribute("width", "31");
  expect(svg).toHaveAttribute("height", "31");
});

it.each([["chevron", ChevronIcon], ["copy", CopyIcon], ["check", CheckIcon]] as const)("%s (Recent errors row) emits a decorative 14px SVG that honors size", (_name, Icon) => {
  // Regression target: drop aria-hidden (the Copy button and row toggle would announce an unnamed graphic).
  const view = render(<Icon />);
  const svg = view.container.querySelector("svg")!;
  expect(svg).toHaveAttribute("width", "14");
  expect(svg).toHaveAttribute("aria-hidden", "true");
  view.rerender(<Icon size={20} />);
  expect(svg).toHaveAttribute("height", "20");
});
