import { expect, it, vi } from "vitest";
import { createMediaApi, type MediaRequestFn } from "../api/media-api.js";

const prefix = "/workspaces/workspace-local/media";
const original = "/api/admin/v1/workspaces/workspace-local/media/p%2Fa%20%26b/original";
const id = "p/a &b";

function setup() {
  const request = vi.fn<(...args: Parameters<MediaRequestFn>) => Promise<unknown>>();
  // The port is generic over the response type; the fake answers whatever each test queued.
  const typedRequest: MediaRequestFn = <T,>(...args: Parameters<MediaRequestFn>) => request(...args) as Promise<T>;
  const siteUrl = vi.fn(({ path }: { path: string }) => `https://public.example${path}`);
  return { request, siteUrl, api: createMediaApi({ request: typedRequest, siteUrl }) };
}

it("targets the live catalog, the plain grid, the opaque next cursor and the exact item lookup", async () => {
  const { api, request } = setup();
  const catalog = { providers: [{ id: "custom-image", label: "Custom Media API" }] };
  const grid = { media: [], hasMore: true, nextCursor: "t/+ =", counts: { all: 60 } };
  const secondPage = { ...grid, hasMore: false, nextCursor: null };
  const lookup = { ...secondPage, media: [{ id }] };
  request.mockResolvedValueOnce(catalog).mockResolvedValueOnce(grid).mockResolvedValueOnce(secondPage).mockResolvedValueOnce(lookup);
  await expect(api.getMediaProviderCatalog()).resolves.toBe(catalog);
  await expect(api.listMediaGrid({ tab: "all", orderBy: "created" })).resolves.toBe(grid);
  await expect(api.listMediaGrid({ tab: "images", orderBy: "alphabetical" }, { limit: 20, cursor: "t/+ =" })).resolves.toBe(secondPage);
  await expect(api.listMediaGrid({ tab: "all", orderBy: "created" }, { itemId: id })).resolves.toBe(lookup);
  expect(request.mock.calls).toEqual([
    [{ path: `${prefix}/providers/catalog` }],
    [{ path: `${prefix}/grid?tab=all&orderBy=created` }],
    [{ path: `${prefix}/grid?tab=images&orderBy=alphabetical&limit=20&cursor=t%2F%2B+%3D` }],
    [{ path: `${prefix}/grid?tab=all&orderBy=created&itemId=p%2Fa+%26b` }],
  ]);
});

it("serves the original from admin and delegates only the public rendition URL to the site origin", () => {
  const { api, siteUrl, request } = setup();
  expect(api.mediaOriginalUrl({ id })).toBe(original);
  expect(api.mediaPreviewRenditionUrl({ id })).toBe("https://public.example/m/p%2Fa%20%26b/public.v1/image.jpg");
  expect(siteUrl.mock.calls).toEqual([[{ path: "/m/p%2Fa%20%26b/public.v1/image.jpg" }]]);
  expect(request.mock.calls).toEqual([]);
});

it.each([
  { status: 200, header: "video/webm", expected: "video/webm" },
  { status: 200, header: null, expected: "" },
  { status: 404, header: "text/html", expected: "" },
])("reads sniffed type with HEAD ($status, $header)", async ({ status, header, expected }) => {
  const { api } = setup();
  const headers = new Headers();
  if (header !== null) headers.set("content-type", header);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status, headers }));
  await expect(api.mediaContentType({ id }, { fetch })).resolves.toBe(expected);
  expect(fetch.mock.calls).toEqual([[original, { method: "HEAD", credentials: "same-origin" }]]);
});

it("uses browser fetch by default and preserves a transport rejection", async () => {
  const { api } = setup();
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("asset connection lost"));
  try {
    await expect(api.mediaContentType({ id })).rejects.toThrow("asset connection lost");
    expect(fetch.mock.calls).toEqual([[original, { method: "HEAD", credentials: "same-origin" }]]);
  } finally {
    fetch.mockRestore();
  }
});

it("keeps import, upload, metadata patch, reversible trash and permanent delete on distinct request contracts", async () => {
  const { api, request } = setup();
  const result = { media: { id, title: "Harbor" } };
  request.mockResolvedValueOnce(result).mockResolvedValueOnce(result).mockResolvedValueOnce(result)
    .mockResolvedValueOnce(result).mockResolvedValueOnce({ purged: true });
  await expect(api.importMediaFromUrl({ url: "https://host.example/harbor.jpg" })).resolves.toBe(result);
  await expect(api.uploadMedia({ filename: "harbor.jpg", contentType: "image/jpeg", dataBase64: "aGk=" }, { alt: "Harbor" })).resolves.toBe(result);
  await expect(api.updateMedia({ id }, { slug: "harbor", width: null })).resolves.toBe(result);
  await expect(api.trashMedia({ id })).resolves.toBe(result);
  await expect(api.deleteMedia({ id })).resolves.toEqual({ purged: true });
  expect(request.mock.calls).toEqual([
    [{ path: `${prefix}/import-url` }, { init: { method: "POST", body: '{"url":"https://host.example/harbor.jpg"}' } }],
    [{ path: prefix }, { init: { method: "POST", body: '{"filename":"harbor.jpg","contentType":"image/jpeg","dataBase64":"aGk=","alt":"Harbor"}' } }],
    [{ path: `${prefix}/p%2Fa%20%26b` }, { init: { method: "PATCH", body: '{"slug":"harbor","width":null}' } }],
    [{ path: `${prefix}/p%2Fa%20%26b/trash` }, { init: { method: "POST" } }],
    [{ path: `${prefix}/p%2Fa%20%26b` }, { init: { method: "DELETE" } }],
  ]);
});

it("isolates private documents from the media listing and forwards text continuation offsets", async () => {
  const { api, request } = setup();
  const first = { id, text: "opening", offset: 0, nextOffset: 65_536, totalBytes: 65_540, truncated: true };
  const last = { id, text: "end!", offset: 65_536, nextOffset: null, totalBytes: 65_540, truncated: false };
  request.mockResolvedValueOnce({ media: [] }).mockResolvedValueOnce({ media: [{ id }] })
    .mockResolvedValueOnce({ media: { id } }).mockResolvedValueOnce(first).mockResolvedValueOnce(last);
  await expect(api.listMedia()).resolves.toEqual({ media: [] });
  await expect(api.listDocuments()).resolves.toEqual({ media: [{ id }] });
  await expect(api.uploadDocument({ filename: "notes.md", dataBase64: "aGk=" })).resolves.toEqual({ media: { id } });
  await expect(api.readDocumentText({ id })).resolves.toBe(first);
  await expect(api.readDocumentText({ id }, { offset: 65_536 })).resolves.toBe(last);
  expect(request.mock.calls).toEqual([
    [{ path: prefix }],
    [{ path: `${prefix}?kind=document` }],
    [{ path: prefix }, { init: { method: "POST", body: '{"filename":"notes.md","dataBase64":"aGk=","kind":"document"}' } }],
    [{ path: `${prefix}/p%2Fa%20%26b/text` }],
    [{ path: `${prefix}/p%2Fa%20%26b/text?offset=65536` }],
  ]);
});

it("reads credential markers outside the catalog route and preserves omitted upload and patch options", async () => {
  const { api, request } = setup();
  const markers = { "custom-image": { apiKeyConfigured: true, apiKeyTail: "1234" } };
  const saved = { media: { id, title: "Unchanged" } };
  request.mockResolvedValueOnce(markers).mockResolvedValueOnce(saved).mockResolvedValueOnce(saved).mockResolvedValueOnce(saved);
  await expect(api.getMediaProviders()).resolves.toEqual(markers);
  await expect(api.importMediaFromUrl({ url: "https://public.example/photo.png" }, { filename: "cover.png", caption: "Cover" })).resolves.toBe(saved);
  await expect(api.uploadMedia({ filename: "plain.png", contentType: "image/png", dataBase64: "cGxhaW4=" })).resolves.toBe(saved);
  await expect(api.updateMedia({ id })).resolves.toBe(saved);
  expect(request.mock.calls).toEqual([
    [{ path: `${prefix}/providers` }],
    [{ path: `${prefix}/import-url` }, { init: { method: "POST", body: '{"url":"https://public.example/photo.png","filename":"cover.png","caption":"Cover"}' } }],
    [{ path: prefix }, { init: { method: "POST", body: '{"filename":"plain.png","contentType":"image/png","dataBase64":"cGxhaW4="}' } }],
    [{ path: `${prefix}/p%2Fa%20%26b` }, { init: { method: "PATCH", body: "{}" } }],
  ]);
});
