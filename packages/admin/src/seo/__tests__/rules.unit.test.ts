import { describe, expect, it, vi } from "vitest";

import { actionLabel, buildMediaRef, orEmpty, overrideOrClear, resolveMediaRefPreviewUrl, sortIssuesBySeverity } from "../react/__tests__/harness/rules.js";
import { describeMediaRef, entryPickerOptions, scoreTone, inheritedXFor, ogImageInherited, xIsCustomized, xResolvedValue } from "../rules.js";
import type { SeoEntryMeta } from "../models.js";
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

describe('entryPickerOptions', () => {
  it('lists Pages before Posts, pills only non-published entries, and keeps untitled ones pickable by id', () => {
    const posts = [{ id: 'p1', title: 'Hello', status: 'published' }, { id: 'p2', title: '  ', status: 'draft' }];
    const pages = [{ id: 'pg1', title: 'About', status: 'published' }];
    expect(entryPickerOptions({ posts, pages }, { t: key => (key === 'draft' ? 'Entwurf' : key) })).toEqual([
      { value: 'pg1', label: 'About', group: 'Pages' },
      { value: 'p1', label: 'Hello', group: 'Posts' },
      { value: 'p2', label: 'p2', group: 'Posts', badge: 'Entwurf' },
    ]);
  });
});

describe('entryPickerOptions — same-titled entries', () => {
  it('keeps both rows and adds the slug as detail only to the duplicates', () => {
    const pages = [
      { id: 'a', title: 'Landing Page', status: 'published', slug: 'landing-page' },
      { id: 'b', title: 'Landing Page', status: 'published', slug: 'landing-page-2' },
      { id: 'c', title: 'About', status: 'published', slug: 'about' },
      { id: 'd', title: 'About', status: 'published' },
    ];
    expect(entryPickerOptions({ posts: [], pages }).map(({ label, detail }) => [label, detail])).toEqual([
      ['Landing Page', 'landing-page'], ['Landing Page', 'landing-page-2'], ['About', 'about'], ['About', 'd'],
    ]);
    expect(entryPickerOptions({ posts: [], pages: [pages[0]!] })[0]).not.toHaveProperty('detail');
  });
});

describe('describeMediaRef', () => {
  const media = [{ id: 'b4879dd4-1be6-4a51-b1a9-1446ec2dc144', slug: 'testing-page', title: 'Testing page', width: 1200, height: 630 }];
  it.each([
    ['', null],
    ['b4879dd4-1be6-4a51-b1a9-1446ec2dc144:public', { name: 'Testing page', size: '1200 × 630' }],
    ['testing-page:public', { name: 'Testing page', size: '1200 × 630' }],
    ['other-slug:public', { name: 'other-slug', size: null }],
    ['0b9e0d7c-1111-4222-8333-444455556666:public', { name: 'Image', size: null }],
    ['https://cdn.example/a/my%20pic.png?v=2', { name: 'my pic.png', size: null }],
    ['https://cdn.example/', { name: 'cdn.example', size: null }],
    ['https://[bad', { name: 'https://[bad', size: null }],
  ])('%s', (value, expected) => {
    expect(describeMediaRef({ value, media })).toEqual(expected);
  });
  it('falls back to the decoded size when the row has none, and translates the opaque-id name', () => {
    expect(describeMediaRef({ value: '0b9e0d7c-1111-4222-8333-444455556666:public' }, { width: 8, height: 8, t: key => `[${key}]` }))
      .toEqual({ name: '[Image]', size: '8 × 8' });
  });
  it('treats a non-string value as empty', () => {
    expect(describeMediaRef({ value: null as unknown as string })).toBeNull();
  });
  it('names a library file with the extension of its stored type', () => {
    const extensionFor = (type: string) => ({ 'image/png': '.png', 'image/jpeg': '.jpg' } as Record<string, string>)[type] ?? '';
    const rows = [
      { id: 'a', slug: 'testing-page', title: 'testing-page', contentType: 'image/png' },
      { id: 'b', slug: 'shot', title: 'shot.JPG', contentType: 'image/jpeg' },
      { id: 'c', slug: 'odd', title: 'odd', contentType: 'image/x-unknown' },
      { id: 'd', slug: 'untyped', title: 'untyped', contentType: null },
    ];
    expect(describeMediaRef({ value: 'testing-page:public', media: rows }, { extensionFor })?.name).toBe('testing-page.png');
    expect(describeMediaRef({ value: 'shot:public', media: rows }, { extensionFor })?.name).toBe('shot.JPG');
    expect(describeMediaRef({ value: 'odd:public', media: rows }, { extensionFor })?.name).toBe('odd');
    expect(describeMediaRef({ value: 'untyped:public', media: rows }, { extensionFor })?.name).toBe('untyped');
    expect(describeMediaRef({ value: 'testing-page:public', media: rows })?.name).toBe('testing-page');
  });
});

describe('scoreTone', () => {
  it.each([[100, 'success'], [80, 'success'], [79, 'warning'], [50, 'warning'], [49, 'failure'], [0, 'failure']] as const)('%i → %s', (score, tone) => {
    expect(scoreTone({ score })).toBe(tone);
  });
});

describe("X (twitter) fields vs the social preview", () => {
  const meta: SeoEntryMeta = {
    title: "T", canonical: "https://e.test/", robots: { noindex: false, nofollow: false }, jsonLd: [],
    openGraph: { title: "Share", description: "Share desc", type: "website", url: "https://e.test/", image: "https://e.test/a.jpg", imageRef: "a:public" },
    twitter: { card: "summary_large_image", title: "Share", description: "Share desc", image: "https://e.test/a.jpg", imageRef: "a:public" },
  };

  it("is not customized while every X value equals the social preview", () => {
    expect(xIsCustomized({ meta })).toBe(false);
  });

  it.each([
    ["title", { title: "X only" }],
    ["description", { description: "X desc" }],
    ["image ref", { imageRef: "b:public" }],
  ])("is customized when the X %s differs", (_name, twitter) => {
    expect(xIsCustomized({ meta: { ...meta, twitter: { ...meta.twitter, ...twitter } } })).toBe(true);
  });

  it("compares pasted image URLs when there is no source ref", () => {
    const { imageRef: _ogRef, ...openGraph } = meta.openGraph;
    const { imageRef: _xRef, ...twitter } = meta.twitter;
    expect(xIsCustomized({ meta: { ...meta, openGraph, twitter } })).toBe(false);
    const pasted = { ...meta, openGraph, twitter: { ...twitter, image: "https://cdn.test/x.png" } };
    expect(xIsCustomized({ meta: pasted })).toBe(true);
  });

  it("leaves an inherited X box empty and shows a real X override", () => {
    expect(xResolvedValue({ key: "twitterTitle", meta })).toBe("");
    expect(xResolvedValue({ key: "twitterImage", meta })).toBe("");
    const custom = { ...meta, twitter: { ...meta.twitter, description: "X desc", imageRef: "b:public" } };
    expect(xResolvedValue({ key: "twitterDescription", meta: custom })).toBe("X desc");
    expect(xResolvedValue({ key: "twitterImage", meta: custom })).toBe("b:public");
  });

  it("a description missing on both sides is inherited; missing only on X reads empty", () => {
    const { description: _og, ...openGraph } = meta.openGraph;
    const { description: _x, ...twitter } = meta.twitter;
    expect(xResolvedValue({ key: "twitterDescription", meta: { ...meta, openGraph, twitter } })).toBe("");
    expect(xResolvedValue({ key: "twitterDescription", meta: { ...meta, twitter } })).toBe("");
  });

  it("an edit to a preview field carries the X field that follows it, and only that one", () => {
    expect(inheritedXFor({ key: "ogTitle", meta, touched: {} })).toBe("twitterTitle");
    expect(inheritedXFor({ key: "ogDescription", meta, touched: {} })).toBe("twitterDescription");
    expect(inheritedXFor({ key: "ogImage", meta, touched: {} })).toBe("twitterImage");
    expect(inheritedXFor({ key: "title", meta, touched: {} })).toBeNull();
    expect(inheritedXFor({ key: "ogTitle", meta, touched: { twitterTitle: "Typed" } })).toBeNull();
    expect(inheritedXFor({ key: "ogTitle", meta: { ...meta, twitter: { ...meta.twitter, title: "X only" } }, touched: {} })).toBeNull();
  });
});

describe("ogImageInherited", () => {
  const meta: SeoEntryMeta = {
    title: "T", canonical: "https://e.test/", robots: { noindex: false, nofollow: false }, jsonLd: [],
    openGraph: { title: "S", type: "website", url: "https://e.test/", image: "https://e.test/a.jpg", imageRef: "card:public" },
    twitter: { card: "summary_large_image", title: "S" },
  };

  it("is inherited when the entry's image is the site default and not being edited", () => {
    expect(ogImageInherited({ meta, defaultOgImage: "card:public", touched: {} })).toBe(true);
  });

  it.each([
    ["an own override", { meta: { ...meta, openGraph: { ...meta.openGraph, imageRef: "mine:public" } }, defaultOgImage: "card:public", touched: {} }],
    ["a pending edit", { meta, defaultOgImage: "card:public", touched: { ogImage: "other:public" } }],
    ["a flagged override equal to the default", { meta: { ...meta, openGraph: { ...meta.openGraph, imageOverridden: true as const } }, defaultOgImage: "card:public", touched: {} }],
    ["no site default", { meta, defaultOgImage: undefined, touched: {} }],
    ["an empty site default", { meta, defaultOgImage: "", touched: {} }],
  ])("is not inherited with %s", (_name, args) => {
    expect(ogImageInherited(args)).toBe(false);
  });

  it("compares a pasted default URL when there is no source ref", () => {
    const { imageRef: _ref, ...openGraph } = meta.openGraph;
    expect(ogImageInherited({ meta: { ...meta, openGraph }, defaultOgImage: "https://e.test/a.jpg", touched: {} })).toBe(true);
  });
});
