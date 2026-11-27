import { expect, it, vi } from "vitest";

import { createApiLibraryPort, type LibraryApiClient, type LibraryFetch } from "../hooks/library-api-port.hooks.js";
import { libraryDocument } from "./library-document-fixture.js";

function setup() {
  const guide = libraryDocument({ id: "guide/1", title: "Owner guide", extension: "md" });
  const refs = libraryDocument({ id: "refs/2", title: "References", extension: "pdf", contentType: "application/pdf" });
  const rows = new Map([[guide.id, guide], [refs.id, refs]]);
  function read(id: string) {
    const media = rows.get(id);
    if (!media) throw new Error(`Unexpected document ID: ${id}`);
    return media;
  }
  const client = {
    listDocuments: vi.fn<LibraryApiClient["listDocuments"]>(async () => ({ media: [...rows.values()].filter(({ status }) => status === "active") })),
    uploadDocument: vi.fn<LibraryApiClient["uploadDocument"]>(async ({ filename, dataBase64 }) => {
      if (filename !== "Minutes.txt" || dataBase64 !== "aGk=") throw new Error("Unexpected upload");
      const media = libraryDocument({ id: "new/3", title: "Minutes", extension: "txt", originalFilename: filename, byteSize: 2 });
      rows.set(media.id, media);
      return { media };
    }),
    updateMedia: vi.fn<LibraryApiClient["updateMedia"]>(async ({ id }, { title }) => {
      const original = read(id);
      const media = { ...original, title, displayFilename: `${title}.md`, version: original.version + 1 };
      rows.set(id, media);
      return { media };
    }),
    trashMedia: vi.fn<LibraryApiClient["trashMedia"]>(async ({ id }) => {
      const media = { ...read(id), status: "trashed" } as const;
      rows.set(id, media);
      return { media };
    }),
    readDocumentText: vi.fn<LibraryApiClient["readDocumentText"]>(async ({ id }) => {
      if (id !== "guide/1") throw new Error("Only the guide is plain text");
      return { text: "# Owner guide", truncated: true };
    }),
    mediaOriginalUrl: vi.fn<LibraryApiClient["mediaOriginalUrl"]>(({ id }) => `/admin/media/${encodeURIComponent(read(id).id)}/original`),
    me: vi.fn<LibraryApiClient["me"]>(async () => ({ effectivePermissions: ["media.read", "media.update"] })),
    listUsers: vi.fn<LibraryApiClient["listUsers"]>(async () => ({ users: [{ principalId: "author-7", username: "lina" }] })),
  };
  const fetchFn = vi.fn<LibraryFetch>().mockRejectedValue(new Error("Unexpected original download"));
  return { port: createApiLibraryPort({ client, fetchFn }), client, fetchFn, guide, refs };
}

it("maps roster, preview text, download URL, permissions and uploader names to the host client", async () => {
  const { port, client, guide, refs } = setup();
  expect(await port.listDocuments()).toEqual({ media: [guide, refs] });
  expect(client.listDocuments).toHaveBeenCalledExactlyOnceWith();
  expect(await port.readDocumentText({ id: "guide/1" })).toEqual({ text: "# Owner guide", truncated: true });
  expect(client.readDocumentText).toHaveBeenCalledExactlyOnceWith({ id: "guide/1" });
  expect(port.documentDownloadUrl({ id: "refs/2" })).toBe("/admin/media/refs%2F2/original");
  expect(client.mediaOriginalUrl).toHaveBeenCalledExactlyOnceWith({ id: "refs/2" });
  expect(await port.me()).toEqual({ effectivePermissions: ["media.read", "media.update"] });
  expect(client.me).toHaveBeenCalledExactlyOnceWith();
  expect(await port.listUsers?.()).toEqual({ users: [{ principalId: "author-7", username: "lina" }] });
  expect(client.listUsers).toHaveBeenCalledExactlyOnceWith();
});

it("maps upload, stem rename and trash to the intended row, reflected on the next list", async () => {
  const { port, client, guide, refs } = setup();
  expect(await port.listDocuments()).toEqual({ media: [guide, refs] });

  const upload = await port.uploadDocument({ filename: "Minutes.txt", dataBase64: "aGk=" });
  const minutes = libraryDocument({ id: "new/3", title: "Minutes", extension: "txt", originalFilename: "Minutes.txt", byteSize: 2 });
  expect(upload).toEqual({ media: minutes });
  expect(client.uploadDocument).toHaveBeenCalledExactlyOnceWith({ filename: "Minutes.txt", dataBase64: "aGk=" });

  const rename = await port.renameDocument({ target: { id: "guide/1" }, input: { title: "Field handbook" } });
  const handbook = { ...guide, title: "Field handbook", displayFilename: "Field handbook.md", version: 4 };
  expect(rename).toEqual({ media: handbook });
  expect(client.updateMedia).toHaveBeenCalledExactlyOnceWith({ id: "guide/1" }, { title: "Field handbook" });

  expect(await port.trashDocument({ id: "refs/2" })).toEqual({ media: { ...refs, status: "trashed" } });
  expect(client.trashMedia).toHaveBeenCalledExactlyOnceWith({ id: "refs/2" });
  expect(await port.listDocuments()).toEqual({ media: [handbook, minutes] });
});

it("fetches the selected original with same-origin credentials and returns its unmodified blob", async () => {
  const { port, client, fetchFn } = setup();
  const pdf = new Blob(["%PDF-1.7"], { type: "application/pdf" });
  const blob = vi.fn(async () => pdf);
  fetchFn.mockResolvedValueOnce({ ok: true, status: 200, blob });
  expect(await port.fetchDocumentBlob({ id: "refs/2" })).toBe(pdf);
  expect(client.mediaOriginalUrl).toHaveBeenCalledExactlyOnceWith({ id: "refs/2" });
  expect(fetchFn).toHaveBeenCalledExactlyOnceWith({ url: "/admin/media/refs%2F2/original", init: { credentials: "same-origin" } });
  expect(blob).toHaveBeenCalledExactlyOnceWith();
});

it("reports a refused original's HTTP status without decoding the body", async () => {
  const { port, fetchFn } = setup();
  const blob = vi.fn(async () => new Blob(["Forbidden"]));
  fetchFn.mockResolvedValueOnce({ ok: false, status: 403, blob });
  await expect(port.fetchDocumentBlob({ id: "guide/1" })).rejects.toThrow(new Error("download failed (403)"));
  expect(fetchFn).toHaveBeenCalledExactlyOnceWith({ url: "/admin/media/guide%2F1/original", init: { credentials: "same-origin" } });
  expect(blob).not.toHaveBeenCalled();
});
