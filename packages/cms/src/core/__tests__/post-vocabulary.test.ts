import { describe, expect, expectTypeOf, it } from "vitest";
import type { PostStatus, PublicPostKind } from "../index.js";
import type { PostRecord } from "../../widgets/host-ports.js";
import type { SeoPostRecord } from "../../seo/ports.js";

/**
 * @file The shared post vocabulary is the one definition of the public kinds and the publication
 * states: the widgets host record and the SEO read record must be typed by it, so a host that
 * widens its own kinds cannot silently widen what public readers accept.
 */
describe("post vocabulary", () => {
  it("names exactly the generic publication states and public kinds", () => {
    expectTypeOf<PostStatus>().toEqualTypeOf<"draft" | "published">();
    expectTypeOf<PublicPostKind>().toEqualTypeOf<"post" | "page">();
    const statuses: readonly PostStatus[] = ["draft", "published"];
    const kinds: readonly PublicPostKind[] = ["post", "page"];
    expect(statuses).toHaveLength(2);
    expect(kinds).toHaveLength(2);
  });

  it("types the widgets host record and the SEO record by the shared unions", () => {
    expectTypeOf<PostRecord["status"]>().toEqualTypeOf<PostStatus>();
    expectTypeOf<PostRecord["kind"]>().toEqualTypeOf<PublicPostKind>();
    expectTypeOf<SeoPostRecord["kind"]>().toEqualTypeOf<PublicPostKind>();
  });
});
