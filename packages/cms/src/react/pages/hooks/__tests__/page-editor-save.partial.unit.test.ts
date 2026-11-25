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
