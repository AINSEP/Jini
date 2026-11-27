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
    useChartRegistryHook: () => ({ registry: { list: () => [], resolveById: () => null }, generation: "g1", stylesheets: ["/chart.css"] }),
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

test('keeps historical cards inline without a canvas and hides a dismissed canvas card', () => {
  const target = document.body.appendChild(document.createElement('div'));
  const handleAgentAction = vi.fn();
  const setDismissed = vi.fn();
  const state = { target: null as HTMLElement | null, dismissed: false, setDismissed, hasError: false, handleAgentAction };
  const props = {
    name: 'a2ui', runId: 'run', clock: { nowMs: () => 0 }, events: [], runStreaming: false, runSucceeded: true,
    SurfaceCard: () => <article aria-label="Generated surface">Saved forecast</article>,
    useTHook: () => (key: string) => key,
    useRoutedA2uiSurfaceCardHook: () => state,
    useChartRegistryHook: () => ({ registry: { list: () => [], resolveById: () => null }, generation: 'g1', stylesheets: ['/forecast.css'] }),
  } satisfies RoutedA2uiSurfaceCardProps;
  const view = render(<RoutedA2uiSurfaceCard {...props} />);
  try {
    expect(view.getByRole('article', { name: 'Generated surface' }).textContent).toBe('Saved forecast');
    expect(view.container.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe('/forecast.css');
    expect(view.queryByRole('button', { name: 'Remove from canvas' })).toBeNull();
    state.target = target;
    view.rerender(<RoutedA2uiSurfaceCard {...props} />);
    expect(target.querySelector('article')?.textContent).toBe('Saved forecast');
    state.dismissed = true;
    view.rerender(<RoutedA2uiSurfaceCard {...props} />);
    expect(view.queryByRole('article', { name: 'Generated surface' })).toBeNull();
    expect(target.childElementCount).toBe(0);
  } finally { view.unmount(); target.remove(); }
});
