import { describe, expect, it } from "vitest";
import type {
  AdminMediaDto, AdminMediaEnvelope, AdminMediaKind, AdminMediaListEnvelope, AdminMediaStatus,
} from "@jini-ai/core/contracts/site/cms-media";

import type { MediaKind, MediaStatus } from "../../../media/types.js";
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
