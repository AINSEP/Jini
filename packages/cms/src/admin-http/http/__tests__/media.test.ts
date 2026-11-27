import { describe, expect, it } from "vitest";
import type {
  AdminMediaDto, AdminMediaEnvelope, AdminMediaKind, AdminMediaListEnvelope, AdminMediaStatus,
} from "@jini-ai/core/contracts/site/cms-media";

import { MediaValidationError, type MediaKind, type MediaStatus } from "../../../media/types.js";
import { toAdminMediaListResponse, toAdminMediaResponse } from "../media.js";
import { mediaIdParam } from "../../routes/media/shared.js";
import { fakeMedia, fakeMediaDto } from "../../routes/media/__tests__/helpers.js";

/**
 * @file rv1123e K1 migration: the media wire DTOs are declared once in neutral Core (the admin client
 * consumes the same declarations); CMS keeps only the serialization, called with object arguments.
 */
/** Mutual assignability, checked by the compiler: `true` only when each side accepts the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("media wire DTOs", () => {
  it("admin media returns a stored description and omits a missing one", () => {
    const described = toAdminMediaResponse({
      media: fakeMedia({ description: "An amber lighthouse above the sea." }),
      contentType: "image/png", publicUrl: "/m/hero/public", byteSize: 1234,
    });
    expect(described.description).toBe("An amber lighthouse above the sea.");
    const undescribed = toAdminMediaResponse({
      media: fakeMedia(), contentType: "image/png", publicUrl: "/m/hero/public", byteSize: 1234,
    });
    expect(undescribed).not.toHaveProperty("description");
  });

  it("serializes through object arguments into the Core shapes", () => {
    const media = fakeMedia();
    const dto: AdminMediaDto = toAdminMediaResponse({ media, contentType: "image/test+ff", publicUrl: "/m/hero/public", byteSize: 1234 });
    expect(dto).toEqual(fakeMediaDto());
    const list: AdminMediaListEnvelope = toAdminMediaListResponse({
      media: [media], contentTypesBySha256: new Map(), publicUrlsById: new Map(), byteSizesBySha256: new Map(),
    });
    const envelope: AdminMediaEnvelope = { media: list.media[0]! };
    expect(envelope.media).toEqual({ ...fakeMediaDto(), contentType: null, publicUrl: null, byteSize: null });
    expect(mediaIdParam({ params: {} })).toBe("");
    expect(mediaIdParam({ params: { mediaId: "a1" } })).toBe("a1");
  });

  it("keeps Core's restated unions identical to the media record types they mirror", () => {
    // Core cannot import CMS, so it restates these unions; a drift on either side fails `tsc` here.
    const parity: [Same<AdminMediaStatus, MediaStatus>, Same<AdminMediaKind, MediaKind>, Same<AdminMediaDto["status"], MediaStatus>] = [true, true, true];
    expect(parity).toEqual([true, true, true]);
  });
});

it("preserves a verified video codec and distinguishes a zero-byte blob from an unmeasured one", () => {
  const media = fakeMedia({ id: "vid-1", kind: undefined, originalFilename: undefined, createdBy: undefined,
    source: { sha256: "c".repeat(64), videoCodec: "h264" } });
  const list = toAdminMediaListResponse({
    media: [media], contentTypesBySha256: new Map([["c".repeat(64), "video/mp4"]]),
    publicUrlsById: new Map([["vid-1", "/media/vid-1"]]), byteSizesBySha256: new Map([["c".repeat(64), 0]]),
  });
  expect(list.media).toEqual([expect.objectContaining({
    id: "vid-1", kind: "media", originalFilename: null, createdBy: null, videoCodec: "h264",
    contentType: "video/mp4", publicUrl: "/media/vid-1", byteSize: 0,
  })]);
});

it("derives a private document's MIME and display name without publishing its blob URL", () => {
  const media = fakeMedia({ kind: "document", title: "Board minutes", originalFilename: "upload.PDF" });
  expect(toAdminMediaResponse({ media, contentType: "image/png", publicUrl: "/media/unsafe", byteSize: 367 }))
    .toMatchObject({ kind: "document", originalFilename: "upload.PDF", displayFilename: "Board minutes.PDF",
      contentType: "application/pdf", publicUrl: null, byteSize: 367 });
});

it("rejects a document row with no filename instead of guessing a content type", () => {
  const media = fakeMedia({ kind: "document", originalFilename: null });
  expect(() => toAdminMediaResponse({ media, contentType: "application/pdf", publicUrl: null, byteSize: 367 }))
    .toThrow(new MediaValidationError({ message: "document filename must be a plain filename of at most 255 characters" }));
});
