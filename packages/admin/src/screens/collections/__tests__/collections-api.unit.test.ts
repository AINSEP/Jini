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

describe("collections writes", () => {
  const fields = [{ name: "quantity", kind: "integer" as const, required: true, queryable: false }];
  const bodyJson = { type: "doc", content: [{ type: "paragraph" }] };
  const fieldsJson = { quantity: 7 };
  const create = { type: "kit", slug: "wrench", title: "Socket wrench" };
  const cases: {
    title: string;
    invoke: (api: ReturnType<typeof createCollectionsApi>) => Promise<unknown>;
    path: string;
    method: string;
    body: unknown;
    response: unknown;
  }[] = [
    { title: "create type", invoke: api => api.createContentType({ key: "kit", label: "Toolkit", fields }),
      path: "/content-types", method: "POST", body: { key: "kit", label: "Toolkit", fields }, response: { contentType: { version: 1, key: "kit" } } },
    { title: "replace fields", invoke: api => api.updateContentTypeFields({ key: "kit/metric?", fields, expectedVersion: 7 }),
      path: "/content-types/kit%2Fmetric%3F/fields", method: "PUT", body: { fields, expectedVersion: 7 }, response: { contentType: { version: 8 } } },
    { title: "deprecate type", invoke: api => api.contentTypeLifecycle({ key: "kit/metric?", op: "deprecate", expectedVersion: 8 }),
      path: "/content-types/kit%2Fmetric%3F/lifecycle", method: "POST", body: { op: "deprecate", expectedVersion: 8 }, response: { contentType: { status: "deprecated" } } },
    { title: "create entry without options", invoke: api => api.createEntry(create),
      path: "/entries", method: "POST", body: create, response: { entry: { slug: "wrench" } } },
    { title: "create entry with rich text", invoke: api => api.createEntry(create, { fieldsJson, bodyJson }),
      path: "/entries", method: "POST", body: { ...create, fieldsJson, bodyJson }, response: { entry: { bodyJson } } },
    { title: "update entry without options", invoke: api => api.updateEntry({ id: "entry#2/", expectedVersion: 9 }),
      path: "/entries/entry%232%2F", method: "PUT", body: { expectedVersion: 9 }, response: { entry: { version: 10 } } },
    { title: "update entry with rich text", invoke: api => api.updateEntry({ id: "entry#2/", expectedVersion: 9 }, { title: "Updated", fieldsJson, bodyJson }),
      path: "/entries/entry%232%2F", method: "PUT", body: { expectedVersion: 9, title: "Updated", fieldsJson, bodyJson }, response: { entry: { version: 10, bodyJson } } },
    { title: "unpublish entry", invoke: api => api.entryLifecycle({ id: "entry#2/", op: "unpublish", expectedVersion: 10 }),
      path: "/entries/entry%232%2F/lifecycle", method: "POST", body: { op: "unpublish", expectedVersion: 10 }, response: { entry: { status: "unpublished" } } },
  ];

  it.each(cases)("sends the exact request and returns the host response for $title", async ({ invoke, path, method, body, response }) => {
    const calls: unknown[][] = [];
    const request: CollectionsRequestFn = async <T,>(...args: Parameters<CollectionsRequestFn>): Promise<T> => {
      calls.push(args);
      expect(args).toEqual([{ path }, { init: { method, body: JSON.stringify(body) } }]);
      return response as T;
    };
    await expect(invoke(createCollectionsApi({ request }))).resolves.toEqual(response);
    expect(calls).toHaveLength(1);
  });
});
