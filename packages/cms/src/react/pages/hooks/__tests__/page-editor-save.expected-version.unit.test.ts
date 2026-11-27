import { expect, test, vi } from "vitest";
import { applySavedPage, writePage } from "../page-editor-save.js";

test("HTML writes use the metadata response version and remain gated", async () => {
  const metadata = { slug: "page", status: "draft" as const, version: 8 };
  const final = { ...metadata, version: 9 };
  const port = { updatePost: vi.fn(async () => ({ post: metadata })), updatePageHtml: vi.fn(async () => ({ post: final })) };
  const plan = { canSaveHtml: true, statusToWrite: "draft" as const, updatePostPayload: { title: "Title", slug: "page", status: "draft" as const, templateChoice: null, expectedVersion: 3 } };
  expect(await writePage({ port, pageId: "page", plan, html: "<p>new</p>" })).toBe(final);
  expect(port.updatePageHtml).toHaveBeenCalledExactlyOnceWith({ id: "page", html: "<p>new</p>", expectedVersion: 8 });
  port.updatePageHtml.mockClear();
  expect(await writePage({ port, pageId: "page", plan: { ...plan, canSaveHtml: false }, html: "refused" })).toBe(metadata);
  expect(port.updatePageHtml).not.toHaveBeenCalled();
});

function mountedPage(status: "draft" | "published" = "draft") {
  const state = {
    page: { slug: "before", status, version: 3 },
    slug: "before",
    status,
    savedTemplateChoice: null as string | null,
    savedHtml: "<p>Previously saved</p>",
    message: "",
  };
  return {
    state,
    setters: {
      setPage: (page: typeof state.page) => { state.page = page; },
      setSlug: (slug: string) => { state.slug = slug; },
      setStatus: (status: typeof state.status) => { state.status = status; },
      setSavedTemplateChoice: (template: string | null) => { state.savedTemplateChoice = template; },
      setSavedHtml: (html: string) => { state.savedHtml = html; },
      setMessage: (message: string) => { state.message = message; },
    },
  };
}

const t = ({ key, locale }: { key: string; locale: string }) => `${locale}/${key}`;
const pageUnchangedSaveMessage: Parameters<typeof applySavedPage>[0]["pageUnchangedSaveMessage"] = ({ t, locale, version }) => t({ locale, key: `Unchanged at v${version}` });
const pageSaveSuccessMessage: Parameters<typeof applySavedPage>[0]["pageSaveSuccessMessage"] = ({ t, locale, canSaveHtml }) => t({ locale, key: canSaveHtml ? "Metadata and HTML saved" : "Metadata saved" });

test("settles the saved metadata and HTML with the returned row's canonical slug and status", () => {
  const { state, setters } = mountedPage();
  applySavedPage({
    updated: { slug: "canonical", status: "published", version: 4 },
    form: { templateChoice: "custom.html", html: "<p>New content</p>", basisVersion: 3 },
    canSaveHtml: true, setters, t, locale: "fr", pageUnchangedSaveMessage, pageSaveSuccessMessage,
  });

  expect(state).toEqual({
    page: { slug: "canonical", status: "published", version: 4 }, slug: "canonical", status: "published",
    savedTemplateChoice: "custom.html", savedHtml: "<p>New content</p>", message: "fr/Metadata and HTML saved",
  });
});

test("reports a same-version save as unchanged and does not mark an unwritable body saved", () => {
  const { state, setters } = mountedPage();
  applySavedPage({
    updated: { slug: "before", status: "draft", version: 3 },
    form: { templateChoice: null, html: "<p>Unsaved edit</p>", basisVersion: 3 },
    canSaveHtml: false, setters, t, locale: "fr", pageUnchangedSaveMessage, pageSaveSuccessMessage,
  });

  expect(state.savedHtml).toBe("<p>Previously saved</p>");
  expect(state.message).toBe("fr/Unchanged at v3");
});

test("acknowledges the explicit publish action even if the server returns the same version", () => {
  const { state, setters } = mountedPage("published");
  applySavedPage({
    updated: { slug: "before", status: "published", version: 3 },
    form: { templateChoice: "", html: "<p>Unsaved edit</p>", basisVersion: 3, nextStatus: "published" },
    canSaveHtml: false, setters, t, locale: "fr", pageUnchangedSaveMessage, pageSaveSuccessMessage,
  });

  expect(state.status).toBe("published");
  expect(state.savedTemplateChoice).toBe("");
  expect(state.savedHtml).toBe("<p>Previously saved</p>");
  expect(state.message).toBe("fr/Metadata saved");
});
