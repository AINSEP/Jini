// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { A2uiSurfaceCardProps } from "../../../../../react/kit.js";
import { resetPlaygroundRenderTargetBus, setPlaygroundRenderTarget } from "../../../../lib/playground-render-target-bus.js";
import { getServerRenderTargetSnapshot, latestSurfaceIdIn, surfaceIdOf, useRoutedA2uiSurfaceCard } from "../use-routed-a2ui-surface-card.hooks.js";

afterEach(() => {
  cleanup();
  resetPlaygroundRenderTargetBus();
});

it.each(["createSurface", "updateComponents", "updateDataModel", "deleteSurface"])("recognizes the %s surface id and ignores wrong-shaped payloads", key => {
  const events = [{ createSurface: { surfaceId: "earlier" } }, { [key]: { surfaceId: "active" } },
    null, "noise", { createSurface: { surfaceId: 7 } }, { createSurface: false }, { unrelated: { surfaceId: "ignored" } }];
  expect(latestSurfaceIdIn({ events })).toBe("active");
  expect(surfaceIdOf({ message: { [key]: { surfaceId: "id" } } })).toBe("id");
  expect(latestSurfaceIdIn({ events: events.slice(2) })).toBeUndefined();
});

const card = { name: "a2ui", runId: "run", runStreaming: true, runSucceeded: false };

it("tracks the live canvas and dismisses/refuses only the active surface, relaying each refusal once", async () => {
  const onAgentAction = vi.fn<NonNullable<A2uiSurfaceCardProps["onAgentAction"]>>(async () => ({ ok: true }));
  const props: A2uiSurfaceCardProps = { ...card, events: [{ createSurface: { surfaceId: "one" } }], onAgentAction };
  const { result, rerender } = renderHook(useRoutedA2uiSurfaceCard, { initialProps: props });
  expect(result.current).toMatchObject({ target: null, dismissed: false, hasError: false });
  const canvas = document.createElement("div");
  act(() => setPlaygroundRenderTarget({ node: canvas }));
  expect(result.current.target).toBe(canvas);
  act(() => result.current.setDismissed({ value: true }));
  expect(result.current.dismissed).toBe(true);
  act(() => result.current.setDismissed({ value: false }));
  expect(result.current.dismissed).toBe(false);
  act(() => result.current.setDismissed({ value: true }));
  const declined = { error: { surfaceId: "one", message: "Invalid layout" } };
  await act(async () => { await expect(result.current.handleAgentAction("run", declined)).resolves.toEqual({ ok: true }); });
  expect(result.current.hasError).toBe(true);
  expect(result.current.handleAgentAction("run", declined)).toBeUndefined();
  expect(onAgentAction.mock.calls).toEqual([["run", declined]]);
  rerender({ ...props, events: [...props.events, { createSurface: { surfaceId: "two" } }] });
  expect(result.current).toMatchObject({ target: canvas, dismissed: false, hasError: false });
  const action = { action: { name: "choose", surfaceId: "two" } };
  await expect(result.current.handleAgentAction("run", action)).resolves.toEqual({ ok: true });
  expect(onAgentAction).toHaveBeenLastCalledWith("run", action);
  act(() => setPlaygroundRenderTarget({ node: null }));
  expect(result.current.target).toBeNull();
});

it("relays diagnostics without a surface id without marking the active surface refused", async () => {
  const diagnostic = { error: { message: "No surface was named" } };
  const onAgentAction = vi.fn(async () => ({ ok: true as const }));
  const { result, rerender } = renderHook(useRoutedA2uiSurfaceCard, {
    initialProps: { ...card, events: [{ createSurface: { surfaceId: "one" } }], onAgentAction } as A2uiSurfaceCardProps,
  });
  await expect(result.current.handleAgentAction("run", diagnostic)).resolves.toEqual({ ok: true });
  expect(onAgentAction).toHaveBeenCalledExactlyOnceWith("run", diagnostic);
  expect(result.current.hasError).toBe(false);
  rerender({ ...card, events: [] });
  expect(result.current.handleAgentAction(undefined, { action: { name: "close" } })).toBeUndefined();
  expect(getServerRenderTargetSnapshot()).toBeNull();
});
