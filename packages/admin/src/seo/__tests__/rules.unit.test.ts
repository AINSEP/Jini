import { describe, expect, it, vi } from "vitest";

import { actionLabel, buildMediaRef, orEmpty, overrideOrClear, resolveMediaRefPreviewUrl, sortIssuesBySeverity } from "../react/__tests__/harness/rules.js";
import type { SeoIssue } from "../models.js";

/**
 * @file Pure-logic coverage for `features/seo/rules.ts` — `sortIssuesBySeverity` is the whole
 * module.
 */

function issue(code: string, severity: SeoIssue["severity"]): SeoIssue {
  return { code, severity, message: `${code} message` };
}

describe("sortIssuesBySeverity", () => {
  it("orders error before warning before info", () => {
    const issues = [issue("i1", "info"), issue("w1", "warning"), issue("e1", "error")];
    expect(sortIssuesBySeverity(issues).map((i) => i.code)).toEqual(["e1", "w1", "i1"]);
  });

  it("sorts an unrecognized severity last, after info, rather than throwing", () => {
    const issues = [
      issue("u1", "unknown-severity" as SeoIssue["severity"]),
      issue("i1", "info"),
      issue("e1", "error"),
    ];
    expect(sortIssuesBySeverity(issues).map((i) => i.code)).toEqual(["e1", "i1", "u1"]);
  });

  it("preserves relative order between issues of the same severity (stable sort)", () => {
    const issues = [issue("e1", "error"), issue("e2", "error"), issue("e3", "error")];
    expect(sortIssuesBySeverity(issues).map((i) => i.code)).toEqual(["e1", "e2", "e3"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(sortIssuesBySeverity([])).toEqual([]);
  });

  it("does not mutate the array passed in", () => {
    const issues = [issue("i1", "info"), issue("e1", "error")];
    const original = [...issues];
    sortIssuesBySeverity(issues);
    expect(issues).toEqual(original);
  });

  it("returns a new array, not the same reference", () => {
    const issues = [issue("e1", "error")];
    expect(sortIssuesBySeverity(issues)).not.toBe(issues);
  });
});

describe("orEmpty", () => {
  it("returns the value unchanged when set", () => {
    expect(orEmpty("hello")).toBe("hello");
  });

  it("returns '' for undefined", () => {
    expect(orEmpty(undefined)).toBe("");
  });

  it("does not fall back for an explicit empty string", () => {
    expect(orEmpty("")).toBe("");
  });
});

describe("overrideOrClear", () => {
  it("maps an emptied box to null — the wire sentinel that REMOVES the override", () => {
    // Not `""`: `setEntrySeoOverrides` stores `""` as a genuine override and `getEntryMeta`
    // resolves overrides with `??`, so a stored `""` beats the site default. Not `undefined`
    // either: `JSON.stringify` drops undefined keys, so the field would never reach the PUT body.
    expect(overrideOrClear("")).toBeNull();
    expect(JSON.parse(JSON.stringify({ title: overrideOrClear("") }))).toEqual({ title: null });
  });

  it("returns a non-empty string unchanged", () => {
    expect(overrideOrClear("A title")).toBe("A title");
  });

  it("does not treat a whitespace-only box as a clear", () => {
    // Deliberate: trimming here would silently rewrite what the operator typed. A space-only
    // override is still an override, and the server's length bound is the only rule on it.
    expect(overrideOrClear("   ")).toBe("   ");
  });

  it("passes both booleans through, so an unchecked robots box stays `false` and never becomes a clear", () => {
    // The noindex/nofollow checkboxes go through the same setter. `false` means "override this
    // entry to indexable", which is NOT the same as removing the override; only a string field has
    // an "emptied" gesture with which to ask for a clear.
    expect(overrideOrClear(false)).toBe(false);
    expect(overrideOrClear(true)).toBe(true);
  });
});

describe("actionLabel", () => {
  it("returns the pending label while pending", () => {
    expect(actionLabel(true, "Saving…", "Save")).toBe("Saving…");
  });

  it("returns the idle label when not pending", () => {
    expect(actionLabel(false, "Saving…", "Save")).toBe("Save");
  });
});

describe("buildMediaRef", () => {
  // readable-slugs S5b: prefers the slug over the id, matching resolveSeoImageRef's own id-or-slug
  // lookup (`apps/website/src/features/seo/media.ts`, S4) — a saved SEO image reference now reads
  // as a slug in the field, not an opaque uuid.
  it("prefers the slug over the id — '{slug}:public'", () => {
    expect(buildMediaRef({ id: "asset-123", slug: "sunset-photo" })).toBe("sunset-photo:public");
  });

  it("falls back to the id when slug is empty (defensive — real assets always have one)", () => {
    expect(buildMediaRef({ id: "asset-123", slug: "" })).toBe("asset-123:public");
  });
});

describe("resolveMediaRefPreviewUrl", () => {
  const mediaOriginalUrl = vi.fn((id: string) => `https://admin.example/media/${id}/original`);

  it("returns null for an empty value", () => {
    expect(resolveMediaRefPreviewUrl("", mediaOriginalUrl)).toBeNull();
    expect(resolveMediaRefPreviewUrl("   ", mediaOriginalUrl)).toBeNull();
  });

  it("returns an absolute http(s) URL unchanged, without calling mediaOriginalUrl", () => {
    expect(resolveMediaRefPreviewUrl("https://cdn.example/pic.png", mediaOriginalUrl)).toBe("https://cdn.example/pic.png");
    expect(mediaOriginalUrl).not.toHaveBeenCalled();
  });

  it("returns a protocol-relative URL unchanged", () => {
    expect(resolveMediaRefPreviewUrl("//cdn.example/pic.png", mediaOriginalUrl)).toBe("//cdn.example/pic.png");
  });

  it("resolves an '{assetId}:{transform}' ref through the injected mediaOriginalUrl builder", () => {
    expect(resolveMediaRefPreviewUrl("asset-123:public", mediaOriginalUrl)).toBe(
      "https://admin.example/media/asset-123/original",
    );
    expect(mediaOriginalUrl).toHaveBeenCalledWith("asset-123");
  });

  it("returns null for a malformed ref with no ':'", () => {
    expect(resolveMediaRefPreviewUrl("not-a-ref", mediaOriginalUrl)).toBeNull();
  });

  it("returns null for a ref with nothing before the ':'", () => {
    expect(resolveMediaRefPreviewUrl(":public", mediaOriginalUrl)).toBeNull();
  });

  it("returns null for a ref with nothing after the ':'", () => {
    expect(resolveMediaRefPreviewUrl("asset-123:", mediaOriginalUrl)).toBeNull();
  });

  it("returns null instead of throwing for a non-string value (a misbehaving caller's fieldValue() ?? '' can still yield a boolean, since ?? only replaces null/undefined)", () => {
    const freshMediaOriginalUrl = vi.fn((id: string) => `https://admin.example/media/${id}/original`);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately violates the declared `string` param
    // to prove the runtime guard, same as `Seo.unit.test.tsx`'s own `fieldValue` mock returning
    // `false` unconditionally for the checkbox-fallback test.
    expect(resolveMediaRefPreviewUrl(false as any, freshMediaOriginalUrl)).toBeNull();
    expect(freshMediaOriginalUrl).not.toHaveBeenCalled();
  });
});
