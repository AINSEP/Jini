import { expect, test, vi } from "vitest";
import { applySaveFailure, PageBodyWriteError, writePage } from "../page-editor-save.js";

test("a failed body keeps the accepted metadata and leaves HTML dirty", async () => {
  const saved = { slug: "saved", status: "published" as const, version: 4 };
  const reason = new Error("body refused");
  const port = { updatePost: async () => ({ post: saved }), updatePageHtml: async () => { throw reason; } };
  const setters = { setPage: vi.fn(), setSlug: vi.fn(), setStatus: vi.fn(), setSavedTemplateChoice: vi.fn(), setSavedHtml: vi.fn(), setSaveConflict: vi.fn(), setError: vi.fn() };
  const readVersionConflict = vi.fn(() => null);
  const pagePartialSaveMessage = vi.fn(() => "Partially saved");
  const plan = { canSaveHtml: true, statusToWrite: "published" as const, updatePostPayload: { title: "Title", slug: "saved", status: "published" as const, templateChoice: "", expectedVersion: 3 } };
  const error = await writePage({ port, pageId: "page", plan, html: "draft" }).catch(e => e);
  expect(error).toBeInstanceOf(PageBodyWriteError);
  applySaveFailure({ e: error, attemptedStatus: "published", form: { templateChoice: "" }, setters, t: ({ key }) => key, locale: "en", readVersionConflict, isUnexpectedServerFailure: () => false, pagePartialSaveMessage });
  expect(setters.setPage).toHaveBeenCalledWith(saved);
  expect(setters.setSlug).toHaveBeenCalledWith("saved");
  expect(setters.setSavedTemplateChoice).toHaveBeenCalledWith("");
  expect(setters.setSavedHtml).not.toHaveBeenCalled();
  expect(setters.setError).toHaveBeenCalledWith("Partially saved");
  expect(readVersionConflict).not.toHaveBeenCalled();
  expect(pagePartialSaveMessage).toHaveBeenCalledWith({ t: expect.any(Function), locale: "en", reason });
});

type Conflict = { currentVersion: number; attemptedStatus: "draft" | "published" | undefined };

function recordFailure(e: unknown, conflictError?: unknown, serverFailure?: Error) {
  const result: { conflict: Conflict | null; error: string | null } = { conflict: null, error: null };
  const metadataWrites: unknown[] = [];
  applySaveFailure({
    e,
    attemptedStatus: "published",
    form: { templateChoice: "news.html" },
    readVersionConflict: ({ error, attemptedStatus }) => conflictError !== undefined && error === conflictError ? { currentVersion: 9, attemptedStatus } : null,
    isUnexpectedServerFailure: ({ error }) => serverFailure !== undefined && error === serverFailure,
    pagePartialSaveMessage: () => "Partially saved",
    t: ({ locale, key }) => `${locale}/${key}`,
    locale: "fr",
    setters: {
      setPage: (page) => metadataWrites.push(page),
      setSlug: (slug) => metadataWrites.push(slug),
      setStatus: (status) => metadataWrites.push(status),
      setSavedTemplateChoice: (template) => metadataWrites.push(template),
      setSaveConflict: (conflict) => { result.conflict = conflict; },
      setError: (error) => { result.error = error; },
    },
  });
  return { ...result, metadataWrites };
}

test("routes a version conflict to the conflict action, not the generic error", () => {
  const conflict = new Error("version mismatch");
  expect(recordFailure(conflict, conflict)).toEqual({
    conflict: { currentVersion: 9, attemptedStatus: "published" }, error: null, metadataWrites: [],
  });
});

test("does not repeat server failure details already shown by the shared failure notice", () => {
  const failure = new Error("503 upstream request ID 42");
  expect(recordFailure(failure, undefined, failure)).toEqual({
    conflict: null, error: "fr/Not saved. Your edits are still here.", metadataWrites: [],
  });
});

const circular: { self?: unknown } = {};
circular.self = circular;
test.each([
  { reason: "a normal Error", e: new Error("Slug is already in use"), message: "Slug is already in use" },
  { reason: "a thrown string", e: "slug refused", message: "fr/failed to save page: slug refused" },
  { reason: "a thrown object", e: { code: "SLUG_IN_USE" }, message: 'fr/failed to save page: {"code":"SLUG_IN_USE"}' },
  { reason: "a circular thrown object", e: circular, message: "fr/failed to save page: [object Object]" },
  { reason: "an unjsonable symbol", e: Symbol("refusal"), message: "fr/failed to save page: Symbol(refusal)" },
  { reason: "nothing thrown", e: undefined, message: "fr/failed to save page" },
  { reason: "null thrown", e: null, message: "fr/failed to save page" },
  { reason: "an oversized refusal", e: `${"x".repeat(300)}discard me`, message: `fr/failed to save page: ${"x".repeat(300)}…` },
])("shows a useful local save error for $reason", ({ e, message }) => {
  expect(recordFailure(e)).toEqual({ conflict: null, error: message, metadataWrites: [] });
});
