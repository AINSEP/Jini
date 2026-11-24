import { describe, expect, it } from "vitest";

import { createCollectionsApi, type CollectionsRequestFn } from "../api/collections-api.js";

/** @file Pins the collections API client to the host-injected `request`. */
describe("createCollectionsApi", () => {
  it("sends every call through the injected request with the route's path", async () => {
    const calls: unknown[][] = [];
    const request = (async (...args: unknown[]) => { calls.push(args); return {}; }) as CollectionsRequestFn;
    const api = createCollectionsApi({ request });
    await api.listContentTypes();
    await api.listEntries({ type: "a b" });
    await api.listEntries();
    expect(calls).toEqual([[{ path: "/content-types" }], [{ path: "/entries?type=a%20b" }], [{ path: "/entries" }]]);
  });
});
