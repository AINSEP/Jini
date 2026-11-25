import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RoutedA2uiSurfaceCard, type RoutedA2uiSurfaceCardProps } from "../RoutedA2uiSurfaceCard.js";
import type { A2uiSurfaceCardProps } from "../A2uiSurfaceCard.js";

afterEach(cleanup);

test("live refusals stay inline while successful portal surfaces dismiss", () => {
  const target = document.createElement("div");
  const setDismissed = vi.fn();
  const SurfaceCard = vi.fn((_props: A2uiSurfaceCardProps) => <div data-testid="surface" />);
  const useRoutedA2uiSurfaceCardHook = vi.fn(() => ({ target, dismissed: false, setDismissed, hasError: true, handleAgentAction: () => {} }));
  const props = {
    name: "a2ui", runId: "run", clock: { nowMs: () => 0 }, events: [], runStreaming: false, runSucceeded: true,
    SurfaceCard, useTHook: () => (key: string) => key, useRoutedA2uiSurfaceCardHook,
    useChartRegistryHook: () => ({ registry: { list: () => [], resolveById: () => null }, generation: 1, stylesheets: ["/chart.css"] }),
  } satisfies RoutedA2uiSurfaceCardProps;
  const view = render(<RoutedA2uiSurfaceCard {...props} />);
  expect(view.container.querySelector('[data-testid="surface"]')).not.toBeNull();
  expect(target.childElementCount).toBe(0);
  expect(SurfaceCard.mock.calls[0]?.[0]).not.toHaveProperty("SurfaceCard");
  useRoutedA2uiSurfaceCardHook.mockReturnValue({ target, dismissed: false, setDismissed, hasError: false, handleAgentAction: () => {} });
  view.rerender(<RoutedA2uiSurfaceCard {...props} />);
  expect(target.querySelector('[data-testid="surface"]')).not.toBeNull();
  const dismiss = target.querySelector("button");
  if (!dismiss) throw new Error("missing dismiss");
  fireEvent.click(dismiss);
  expect(setDismissed).toHaveBeenCalledWith({ value: true });
});
