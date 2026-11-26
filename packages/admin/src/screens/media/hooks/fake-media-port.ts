import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { asciiSlug } from "../../../shell/lib/ascii-slug.js";
import { trimChars } from "@jini-ai/core/primitives";
import type { MediaPort } from "./media-port.hooks.js";

/**
 * @file In-memory {@link MediaPort} for tests — ships beside the port's type per the pattern's
 * "every port gets a fake" rule. The live binding is the host's.
 */

/** Seed state for {@link createFakeMediaPort}. */
export interface FakeMediaPortOptions {
  media?: AdminMedia[];
}

/**
 * An in-memory {@link MediaPort} for tests — lets a test describe "the library has these two
 * items" or "an upload with this alt text" directly, instead of hand-building `Response` objects
 * and stubbing global `fetch`. Shipped alongside the real binding per the pattern's "every port
 * gets a fake" rule.
 */
export function createFakeMediaPort(options: FakeMediaPortOptions = {}): MediaPort & {
  /** Every item currently in the fake's store, in list order. */
  readonly items: AdminMedia[];
} {
  const items = [...(options.media ?? [])];

  function newItem(input: { filename: string; contentType: string; dataBase64: string }, opts: { alt?: string | undefined; caption?: string; credit?: string }): AdminMedia {
    return {
      id: `fake-${items.length + 1}`,
      workspaceId: "fake-ws",
      status: "active",
      sha256: `fake-sha-${items.length + 1}`,
      title: input.filename,
      // Rough approximation of the real server's `slugifyMediaTitle` (`@jini-ai/cms/media`) — good
      // enough for a fake store's own uniqueness-free happy path; a test needing a REAL collision or
      // conflict must seed `options.media` directly with an explicit `slug`, same as `contentType`'s
      // own disclosed limit above.
      slug: asciiSlug({ text: input.filename, trimChars }) || "untitled",
      alt: opts.alt ?? "",
      caption: opts.caption ?? "",
      credit: opts.credit ?? "",
      width: null,
      height: null,
      cssClass: null,
      htmlAttributes: null,
      // The REAL server ignores this declared string and stores `sniffContentType(bytes)` instead
      // (see the host server's upload route). This fake has no bytes to sniff — its input is
      // an opaque base64 string a test made up — so it echoes what the caller declared. A test that
      // needs the two to disagree (uploading bytes whose real type differs from the declared one)
      // must seed `options.media` directly rather than rely on this path.
      contentType: input.contentType,
      publicUrl: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      version: 1,
    };
  }

  /** Index plus the item itself — the item is read through `find` so it is typed `AdminMedia`, not
   *  `AdminMedia | undefined` the way an indexed read is. */
  function locate(id: string): { index: number; current: AdminMedia } {
    const index = items.findIndex((item) => item.id === id);
    const current = items[index];
    if (current === undefined) throw new Error(`fake media not found: ${id}`);
    return { index, current };
  }

  return {
    items,

    async listMedia() {
      return { media: [...items] };
    },

    async uploadMedia(input, options = {}) {
      const created = newItem(input, options);
      items.push(created);
      return { media: created };
    },

    async updateMedia({ id }, options = {}) {
      const { index, current } = locate(id);
      const updated: AdminMedia = Object.assign({}, current, options);
      items[index] = updated;
      return { media: updated };
    },

    async trashMedia(id) {
      const { index, current } = locate(id);
      const trashed: AdminMedia = { ...current, status: "trashed" };
      items[index] = trashed;
      return { media: trashed };
    },

    async restoreMedia(id) {
      const { index, current } = locate(id);
      items[index] = { ...current, status: "active" };
      return { restored: true };
    },

    async deleteMedia(id) {
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) throw new Error(`fake media not found: ${id}`);
      items.splice(index, 1);
      return { purged: true };
    },

    // A distinct `fake://` scheme, not `api.mediaOriginalUrl`'s real
    // `/workspaces/.../media/.../original` shape — so a test asserting a resolved URL came from
    // THIS fake fails if a consumer ever goes back to calling the real `api` directly.
    mediaOriginalUrl(id) {
      return `fake://media-original/${id}`;
    },
  };
}
