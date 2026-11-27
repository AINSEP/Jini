import type { MediaProviderOption } from "@jini-ai/core";
import { act, renderHook } from "@testing-library/react";
import { useEffect, useState } from "react";
import { expect, it, vi } from "vitest";
import { useMediaProviderCatalog } from "../use-media-provider-catalog.hooks.js";

function pendingCatalog() {
  let deliver!: (catalog: readonly MediaProviderOption[] | null) => void;
  const pending = new Promise<readonly MediaProviderOption[] | null>((resolve) => { deliver = resolve; });
  const port = { fetchMediaProviderCatalog: vi.fn(() => pending) };
  return { port, deliver };
}

it("exposes the host catalog unchanged and does not refetch on a normal render", async () => {
  const { port, deliver } = pendingCatalog();
  const { result, rerender } = renderHook(() => useMediaProviderCatalog({ port, useEffect, useState }));
  expect(result.current).toBeNull();

  const catalog = [
    { id: "z-plugin", label: "Studio", models: ["cinema-v2"] },
    { id: "a-plugin", label: "Gallery", defaultBaseUrl: "https://gallery.example" },
  ];
  await act(async () => deliver(catalog));
  rerender();

  expect(result.current).toEqual([
    { id: "z-plugin", label: "Studio", models: ["cinema-v2"] },
    { id: "a-plugin", label: "Gallery", defaultBaseUrl: "https://gallery.example" },
  ]);
  expect(port.fetchMediaProviderCatalog.mock.calls).toEqual([[]]);
});

it("does not let a superseded host reply replace the current host's catalog", async () => {
  const old = pendingCatalog();
  const current = pendingCatalog();
  const { result, rerender } = renderHook(({ port }) => useMediaProviderCatalog({ port, useEffect, useState }), { initialProps: { port: old.port } });
  rerender({ port: current.port });
  expect(old.port.fetchMediaProviderCatalog.mock.calls).toEqual([[]]);
  expect(current.port.fetchMediaProviderCatalog.mock.calls).toEqual([[]]);
  await act(async () => current.deliver([{ id: "current", label: "Current host" }]));
  await act(async () => old.deliver([{ id: "old", label: "Old host" }]));

  expect(result.current).toEqual([{ id: "current", label: "Current host" }]);
});

it("distinguishes an empty host catalog from an unavailable one", async () => {
  const empty = pendingCatalog();
  const unavailable = pendingCatalog();
  const { result, rerender } = renderHook(({ port }) => useMediaProviderCatalog({ port, useEffect, useState }), { initialProps: { port: empty.port } });
  await act(async () => empty.deliver([]));
  expect(result.current).toEqual([]);

  rerender({ port: unavailable.port });
  expect(unavailable.port.fetchMediaProviderCatalog.mock.calls).toEqual([[]]);
  await act(async () => unavailable.deliver(null));
  expect(result.current).toBeNull();
});
