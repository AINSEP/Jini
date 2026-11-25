import { describe, expect, it } from "vitest";
import { createFakeMediaPort } from "../fake-media-port.js";

describe("createFakeMediaPort", () => {
  it("permanently deletes only the requested item from the readable store", async () => {
    const port = createFakeMediaPort();
    const input = { filename: "Cat.png", contentType: "image/png", dataBase64: "AA==" };
    const { media: cat } = await port.uploadMedia(input);
    const { media: dog } = await port.uploadMedia({ ...input, filename: "Dog.png" });
    await expect(port.deleteMedia(cat.id)).resolves.toEqual({ purged: true });
    expect(port.items).toEqual([dog]);
    await expect(port.listMedia()).resolves.toEqual({ media: [dog] });
  });

  it.each(["updateMedia", "trashMedia", "restoreMedia", "deleteMedia"] as const)("%s rejects a missing id without changing the store", async (operation) => {
    const port = createFakeMediaPort();
    const { media } = await port.uploadMedia({ filename: "kept.png", contentType: "image/png", dataBase64: "AA==" });
    const pending = operation === "updateMedia" ? port.updateMedia({ id: "missing" }) : port[operation]("missing");
    await expect(pending).rejects.toThrow("fake media not found: missing");
    await expect(port.listMedia()).resolves.toEqual({ media: [media] });
  });

  it("uses untitled when a filename contains no slug characters and preserves explicit metadata", async () => {
    const port = createFakeMediaPort();
    const { media } = await port.uploadMedia(
      { filename: "???", contentType: "image/png", dataBase64: "AA==" },
      { alt: "Cat", caption: "At rest", credit: "Photographer" },
    );
    expect(media).toMatchObject({ slug: "untitled", alt: "Cat", caption: "At rest", credit: "Photographer" });
    await expect(port.updateMedia({ id: media.id })).resolves.toEqual({ media });
    await expect(port.trashMedia(media.id)).resolves.toEqual({ media: { ...media, status: "trashed" } });
    await expect(port.listMedia()).resolves.toEqual({ media: [{ ...media, status: "trashed" }] });
    await expect(port.restoreMedia(media.id)).resolves.toEqual({ restored: true });
    await expect(port.listMedia()).resolves.toEqual({ media: [{ ...media, status: "active" }] });
  });
});
