// @vitest-environment jsdom
import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { mediaItemPath, useMediaItemLink } from "../use-media-item-link.hooks.js";

const original = { url: window.location.href, state: window.history.state };
const asset = (id: string): AdminMedia => ({
  id, workspaceId: "ws", title: id, slug: id, alt: "", caption: "", credit: "", sha256: "sha",
  status: "active", createdAt: "", updatedAt: "", version: 1, width: null, height: null,
  cssClass: null, htmlAttributes: null, contentType: "image/png", publicUrl: null,
});
const media = [asset("clip / &"), asset("poster")];

beforeEach(() => window.history.replaceState(null, "", "/admin/media?tab=videos&id=clip%20%2F%20%26"));
afterEach(() => window.history.replaceState(original.state, "", original.url));

it("encodes one item without allowing its ID to become another query parameter", () => {
  expect(mediaItemPath({ activeTab: "videos", id: "clip / &" })).toBe("/media?tab=videos&id=clip%20%2F%20%26");
  expect(mediaItemPath({ activeTab: "images", id: null })).toBe("/media?tab=images");
});

it("opens a bookmark, replaces rather than pushes selection changes, and clears a stale URL ID on close", () => {
  const length = window.history.length;
  const { result, rerender } = renderHook(({ itemId }: { itemId: string | null }) => {
    const [editingId, setEditingId] = useState<string | null>(null);
    const { notFound } = useMediaItemLink({ itemId, activeTab: "videos", media, editingId, setEditingId });
    return { editingId, setEditingId, notFound };
  }, { initialProps: { itemId: "clip / &" } });
  expect(result.current.editingId).toBe("clip / &");
  expect(result.current.notFound).toBe(false);
  expect(window.location.search).toBe("?tab=videos&id=clip%20%2F%20%26");
  act(() => result.current.setEditingId("poster"));
  expect(window.location.search).toBe("?tab=videos&id=poster");
  act(() => result.current.setEditingId(null));
  expect(window.location.search).toBe("?tab=videos");
  expect(window.history.length).toBe(length);
  rerender({ itemId: "poster" });
  expect(result.current.editingId).toBe("poster");
  expect(window.location.search).toBe("?tab=videos&id=poster");
  rerender({ itemId: null });
  expect(result.current.editingId).toBeNull();
  expect(window.location.search).toBe("?tab=videos");
});

it("reports a missing ID only once the loaded catalog can answer it", () => {
  const { result, rerender } = renderHook(({ items, itemId }: { items: AdminMedia[] | null; itemId: string | undefined }) => {
    const [editingId, setEditingId] = useState<string | null>(null);
    return useMediaItemLink({ itemId, activeTab: "all", media: items, editingId, setEditingId });
  }, { initialProps: { items: null, itemId: "missing" } });
  expect(result.current.notFound).toBe(false);
  rerender({ items: media, itemId: "missing" });
  expect(result.current.notFound).toBe(true);
  rerender({ items: media, itemId: undefined });
  expect(result.current.notFound).toBe(false);
});
