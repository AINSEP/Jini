import { describe, expect, it } from "vitest";

import {
  pageVersionConflictMessage,
  buildPageAutosaveDraft,
  buildPageSavePlan,
  pageAcceptsHtmlBody,
  pageAutosaveStaleBasisMessage,
  pageDirtyGuardBaseline,
  pageEditableHtml,
  pagePartialSaveMessage,
  PAGE_PREVIEW_IFRAME_SANDBOX,
  pagePreviewFormTarget,
  pageRefreshMayHaveUnsavedEdits,
  pickerValueToChoice,
  THEME_DEFAULT_SENTINEL,
  type PageEditorRecord,
} from "../page-editor-rules.js";

/**
 * @file Pure logic for `page-editor-rules.ts` — moved with the editor rules from the host's pages
 * `rules.unit.test.ts`, whose link-rule, theme-rule and translated-copy tests stay with it.
 */

const PUBLISHED_PAGE: PageEditorRecord = {
  id: "pg1",
  title: "About",
  slug: "about",
  status: "published",
};

const identityT = (key: string): string => key;

function page(overrides: Partial<PageEditorRecord> = {}): PageEditorRecord {
  return { ...PUBLISHED_PAGE, ...overrides };
}

/**
 * The predicate behind "the Pages editor cannot write HTML into a newly created page" (2026-09-06).
 * `New Page` -> `createPost` -> `bodyFormat: "doc"` with `DEFAULT_BODY_JSON`, and the flat
 * `bodyFormat === "html"` test this replaced made every keystroke of hand-authored markup on such a
 * page unsavable. The two guards below are what keep the F01 data-loss fix intact — see the
 * function's own doc.
 */
describe("pageAcceptsHtmlBody", () => {
  const EMPTY_DOC = { type: "doc", content: [] };
  const REAL_DOC = { type: "doc", content: [{ type: "paragraph" }] };

  it("is true for an html-format page, authored or not", () => {
    expect(pageAcceptsHtmlBody({ page: { bodyFormat: "html", bodyJson: {} }, html: "<p>x</p>" })).toBe(true);
    expect(pageAcceptsHtmlBody({ page: { bodyFormat: "html", bodyJson: {} }, html: "" })).toBe(true);
  });

  it("is true for a brand-new doc-format page once HTML is actually authored into it", () => {
    expect(pageAcceptsHtmlBody({ page: { bodyFormat: "doc", bodyJson: EMPTY_DOC }, html: "<h1>hi</h1>" })).toBe(true);
  });

  it("is false for a doc-format page with nothing authored — no premature conversion on a metadata save", () => {
    expect(pageAcceptsHtmlBody({ page: { bodyFormat: "doc", bodyJson: EMPTY_DOC }, html: "" })).toBe(false);
  });

  it("is false for a doc-format page carrying a real Tiptap document, even with HTML typed (the F01 guard)", () => {
    expect(pageAcceptsHtmlBody({ page: { bodyFormat: "doc", bodyJson: REAL_DOC }, html: "<p>typed over it</p>" })).toBe(false);
  });

  it("treats an absent or non-array content field as nothing to lose", () => {
    expect(pageAcceptsHtmlBody({ page: { bodyFormat: "doc", bodyJson: {} }, html: "<p>x</p>" })).toBe(true);
    expect(pageAcceptsHtmlBody({ page: { bodyFormat: "doc", bodyJson: { content: "not an array" } }, html: "<p>x</p>" })).toBe(true);
  });

  it("treats an absent bodyFormat the same as doc — an older row that predates the column", () => {
    expect(pageAcceptsHtmlBody({ page: { bodyJson: REAL_DOC }, html: "<p>x</p>" })).toBe(false);
    expect(pageAcceptsHtmlBody({ page: { bodyJson: EMPTY_DOC }, html: "<p>x</p>" })).toBe(true);
  });
});

describe("buildPageSavePlan", () => {
  const FORM = { title: "About", slug: "about", status: "draft" as const, templateChoice: null, html: "<p>body</p>" };

  it.each([undefined, "published"] as const)("includes the chosen template and slug in the full metadata payload (%s)", (nextStatus) => {
    const plan = buildPageSavePlan({
      page: { bodyFormat: "html", bodyJson: {}, version: 7 },
      form: { ...FORM, slug: "new-slug", templateChoice: "blog-post.html" } },
      { nextStatus }
    );
    expect(plan.updatePostPayload).toEqual({
      title: "About",
      slug: "new-slug",
      status: nextStatus ?? "draft",
      templateChoice: "blog-post.html",
      expectedVersion: 7,
    });
  });

  it("omits bodyJson for an already-html row — the metadata writer no longer demands one", () => {
    const plan = buildPageSavePlan({ page: { bodyFormat: "html", bodyJson: { type: "doc", content: [] }, version: 7 }, form: FORM });
    expect(plan.canSaveHtml).toBe(true);
    expect(plan.updatePostPayload).not.toHaveProperty("bodyJson");
  });

  it("round-trips bodyJson whenever the HTML route will not fire", () => {
    const bodyJson = { type: "doc", content: [{ type: "paragraph" }] };
    const plan = buildPageSavePlan({ page: { bodyFormat: "doc", bodyJson, version: 7 }, form: FORM });
    expect(plan.canSaveHtml).toBe(false);
    expect(plan.updatePostPayload.bodyJson).toEqual(bodyJson);
  });

  it("saves the HTML authored into a brand-new page — the 2026-09-06 fix", () => {
    const plan = buildPageSavePlan({ page: { bodyFormat: "doc", bodyJson: { type: "doc", content: [] }, version: 7 }, form: FORM });
    expect(plan.canSaveHtml).toBe(true);
    expect(plan.updatePostPayload.bodyJson).toEqual({ type: "doc", content: [] });
  });

  it("prefers nextStatus over the form's own status, and writes it to both fields", () => {
    const plan = buildPageSavePlan({ page: { bodyFormat: "html", bodyJson: {}, version: 7 }, form: FORM }, { nextStatus: "published" });
    expect(plan.statusToWrite).toBe("published");
    expect(plan.updatePostPayload.status).toBe("published");
  });

  it("falls back to the form's status when no nextStatus is given", () => {
    const plan = buildPageSavePlan({ page: { bodyFormat: "html", bodyJson: {}, version: 7 }, form: { ...FORM, status: "published" } });
    expect(plan.statusToWrite).toBe("published");
  });
});

describe("buildPageAutosaveDraft", () => {
  it("an html-format page sends bodyHtml, never the inert bodyJson placeholder", () => {
    const draft = buildPageAutosaveDraft({
      page: { bodyFormat: "html", bodyJson: { type: "doc", content: [] }, version: 3 },
      form: { title: "About", slug: "about", html: "<main>hi</main>" }
    });
    expect(draft).toEqual({
      bodyFormat: "html",
      bodyHtml: "<main>hi</main>",
      title: "About",
      slug: "about",
      baseVersion: 3,
    });
  });

  it("a doc-format page round-trips bodyJson unchanged — this editor has no way to edit it", () => {
    const bodyJson = { type: "doc", content: [{ type: "paragraph" }] };
    const draft = buildPageAutosaveDraft({
      page: { bodyFormat: "doc", bodyJson, version: 1 },
      form: { title: "About", slug: "about", html: "ignored for a doc-format page" }
    });
    expect(draft).toEqual({
      bodyFormat: "doc",
      bodyJson,
      title: "About",
      slug: "about",
      baseVersion: 1,
    });
  });

  it("baseVersion always comes from the page's own version, not a caller-supplied guess", () => {
    const draft = buildPageAutosaveDraft({
      page: { bodyFormat: "html", bodyJson: {}, version: 42 },
      form: { title: "About", slug: "about", html: "<p/>" }
    });
    expect(draft.baseVersion).toBe(42);
  });
});


/**
 * The stale-basis notice's copy, pinned literally. `toBe` on the whole sentence, not a substring
 * match: this is the only thing an operator ever learns about a running editor that has silently
 * stopped persisting their work, so each clause is load-bearing and a reworded one should have to be
 * a deliberate edit here. In particular it must never grow a promise that the text is recoverable
 * after a reload — see the function's own doc for why that promise cannot be kept.
 */
describe("pageAutosaveStaleBasisMessage", () => {
  const EXPECTED =
    "Someone else saved this while you were editing — you were working from version 4, so autosaving " +
    "has paused and nothing you type now is being stored. Your changes were NOT saved, and are still " +
    "here in the editor. Reload to pick up their version and resume autosaving; copy anything you " +
    "want to keep first.";

  it("names the basis the operator was working from, and states all four facts they cannot infer", () => {
    const message = pageAutosaveStaleBasisMessage({ t: identityT, baseVersion: 4 });

    expect(message).toBe(EXPECTED);
    // Spelled out so a reword that drops one of them fails here rather than silently shipping.
    expect(message).toContain("version 4");
    expect(message).toContain("autosaving has paused");
    expect(message).toContain("were NOT saved");
    expect(message).toContain("still here in the editor");
  });

  it("promises no recovery it cannot deliver — the browser-storage mirror is best-effort and unnamed", () => {
    const message = pageAutosaveStaleBasisMessage({ t: identityT, baseVersion: 4 });

    expect(message).not.toMatch(/restore|recover|saved locally|in your browser/i);
  });
});

/** H1's own message — see `use-page-editor.hooks.ts`'s `PageBodyWriteError`/`applySaveFailure` for
 *  when this fires: the metadata write landed but the body write then failed. */
describe("pagePartialSaveMessage", () => {
  const t = ({ locale, key }: { locale: string; key: string }) => `${locale}:${key}`;

  it("names what saved, what did not, and appends the underlying reason", () => {
    const message = pagePartialSaveMessage({ t, locale: "en", reason: new Error("boom") });

    expect(message).toBe(
      "en:Title, slug and status saved, but the page content wasn't. Your content is still here — press Save to retry. (boom)"
    );
  });

  it("falls back to the generic failure copy for a non-Error rejection", () => {
    const message = pagePartialSaveMessage({ t, locale: "en", reason: "not an Error" });

    expect(message).toBe(
      "en:Title, slug and status saved, but the page content wasn't. Your content is still here — press Save to retry. (en:failed to save page)"
    );
  });

  it("falls back to the generic failure copy for an Error with an empty message", () => {
    expect(pagePartialSaveMessage({ t, locale: "en", reason: new Error("") })).toBe(
      "en:Title, slug and status saved, but the page content wasn't. Your content is still here — press Save to retry. (en:failed to save page)"
    );
  });
});

describe("pageVersionConflictMessage with unknown versions", () => {
  it("explains a newer save without inventing either missing version", () => {
    expect(pageVersionConflictMessage({ t: identityT, expectedVersion: null, currentVersion: null }), "unknown Page versions retain unsaved-work copy without an ordinary overwrite promise")
      .toBe("Someone else saved this while you were editing — you were working from the version you loaded, and a newer version is now stored. Your changes were NOT saved, and are still here in the editor.");
  });
});

const LOADED_PAGE: PageEditorRecord = {
  id: "pg-1",
  title: "Landing",
  slug: "landing",
  status: "published",
};

describe("pagePreviewFormTarget", () => {
  it("is empty before the page loads", () => {
    expect(pagePreviewFormTarget({ page: null })).toBe("");
  });

  it("names the loaded page's id", () => {
    expect(pagePreviewFormTarget({ page: LOADED_PAGE })).toBe("page-preview-pending-pg-1");
  });
});

describe("pageDirtyGuardBaseline", () => {
  it("is null before the page loads", () => {
    expect(pageDirtyGuardBaseline({ page: null, savedHtml: "<p>saved</p>", savedTemplateChoice: "pages-default.html" })).toBeNull();
  });

  it("pairs the loaded row's title/slug/status with the SAVED html and template choice", () => {
    expect(pageDirtyGuardBaseline({ page: LOADED_PAGE, savedHtml: "<p>saved</p>", savedTemplateChoice: "pages-default.html" })).toEqual({
      title: "Landing",
      slug: "landing",
      status: "published",
      html: "<p>saved</p>",
      templateChoice: "pages-default.html",
    });
  });
});

describe("pageEditableHtml", () => {
  it("returns bodyHtml for an html-format page", () => {
    expect(pageEditableHtml(page({ bodyFormat: "html", bodyHtml: "<p>hi</p>" }))).toBe("<p>hi</p>");
  });

  it("returns \"\" for a doc-format page", () => {
    expect(pageEditableHtml(page({ bodyFormat: "doc", bodyHtml: "<p>ignored</p>" }))).toBe("");
  });

  it("returns \"\" for a null bodyHtml on an html-format page", () => {
    expect(pageEditableHtml(page({ bodyFormat: "html", bodyHtml: null }))).toBe("");
  });
});

describe("pageRefreshMayHaveUnsavedEdits", () => {
  it("is false for a clean editor on the Preview or HTML tab", () => {
    expect(pageRefreshMayHaveUnsavedEdits({ dirty: false, view: "preview" })).toBe(false);
    expect(pageRefreshMayHaveUnsavedEdits({ dirty: false, view: "html" })).toBe(false);
  });

  it("is true for a dirty editor on any tab", () => {
    expect(pageRefreshMayHaveUnsavedEdits({ dirty: true, view: "preview" })).toBe(true);
    expect(pageRefreshMayHaveUnsavedEdits({ dirty: true, view: "html" })).toBe(true);
    expect(pageRefreshMayHaveUnsavedEdits({ dirty: true, view: "interactive" })).toBe(true);
  });

  it("is true on the Interactive tab even when dirty reads false, since canvas typing may not have reached html yet", () => {
    expect(pageRefreshMayHaveUnsavedEdits({ dirty: false, view: "interactive" })).toBe(true);
  });
});

describe("pickerValueToChoice (bare-page ruling 2026-09-23, S6)", () => {
  it("pickerValueToChoice maps the sentinel back to null", () => {
    expect(pickerValueToChoice({ value: THEME_DEFAULT_SENTINEL })).toBeNull();
  });

  it("pickerValueToChoice passes every other value through unchanged, including \"\"", () => {
    expect(pickerValueToChoice({ value: "" })).toBe("");
    expect(pickerValueToChoice({ value: "pages-default.html" })).toBe("pages-default.html");
  });
});


describe("PAGE_PREVIEW_IFRAME_SANDBOX", () => {
  it("is exactly the three flags the preview needs, and never lets the preview navigate the admin tab", () => {
    expect(PAGE_PREVIEW_IFRAME_SANDBOX.split(" ").sort()).toEqual(["allow-forms", "allow-popups", "allow-scripts"]);
    expect(PAGE_PREVIEW_IFRAME_SANDBOX).not.toMatch(/allow-top-navigation/);
    expect(PAGE_PREVIEW_IFRAME_SANDBOX).not.toMatch(/allow-popups-to-escape-sandbox/);
  });

  // 2026-10-05: both preview branches load admin-origin documents (the template-preview route always,
  // the live site in production). `allow-scripts` + `allow-same-origin` there lets preview script read
  // `parent.document`, call `/api/admin/*` with the owner's session, and strip its own sandbox.
  it("never grants allow-same-origin, so preview script runs in an opaque origin", () => {
    expect(PAGE_PREVIEW_IFRAME_SANDBOX.split(" ")).not.toContain("allow-same-origin");
  });
});
