import { describe, expect, it, vi } from "vitest";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { describeMediaHtmlAttributeError, mediaRowMenuItems, visibleMediaError } from "../rules.js";

/** The rules take the host's translator and error describer as arguments; these fakes prove that is the only seam. */
const translate = ({ locale, key }: { locale: string; key: string }) => `${locale}:${key}`;

describe("media rules injected collaborators", () => {
  it("describes an HTML-attribute error through the supplied translator", () => {
    const text = describeMediaHtmlAttributeError({ error: { reason: "event-handler", attribute: "onerror" }, locale: "fr", translate });
    expect(text).toContain("fr:");
    expect(text).toContain("onerror");
  });

  it("builds the row menu labels through the supplied translator", () => {
    const item = { id: "m1", status: "published" } as unknown as AdminMedia;
    const handlers = { onToggleEdit: vi.fn(), onTrash: vi.fn(), onRequestPurge: vi.fn() };
    const items = mediaRowMenuItems({ item, editingId: null, handlers, locale: "de", translate });
    expect(items.map((entry) => entry.label)).toEqual(["de:Edit metadata", "de:Trash"]);
  });

  it("surfaces list failures through the supplied describer and prefers trash errors", () => {
    const describeApiError = vi.fn(({ e, fallback }: { e: unknown; fallback: string }) => `${fallback}/${(e as Error).message}`);
    const base = { trashError: null, purgeError: null, deleteFallback: "del", restoreError: null, restoreFallback: "res", listError: new Error("L"), listFallback: "list", hasMedia: false, describeApiError };
    expect(visibleMediaError(base)).toBe("list/L");
    expect(visibleMediaError({ ...base, trashError: new Error("T") })).toBe("del/T");
    expect(visibleMediaError({ ...base, hasMedia: true })).toBeNull();
  });
});
