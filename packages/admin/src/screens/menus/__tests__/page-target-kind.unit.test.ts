import { expect, it } from "vitest";
import { hasPageLinks, menuTargetEditorKind, pageItemsForSave, pageLinkState, pageTargetForChoice, targetForKind, type PageMenuTarget } from "../page-link-rules.js";

it("distinguishes Page from existing generic Entry links without changing the public ref discriminator", () => {
  const entry = { kind: "entryRef" as const, entryId: "post-1" };
  expect(menuTargetEditorKind({ target: entry })).toBe("entryRef");
  const page = targetForKind({ kind: "page", prev: entry });
  expect(page).toEqual({ kind: "entryRef", entryId: "post-1", entryType: "page" });
  expect(menuTargetEditorKind({ target: page })).toBe("page");
  expect(targetForKind({ kind: "entryRef", prev: page })).toEqual(entry);
  expect(targetForKind({ kind: "url", prev: page })).toEqual({ kind: "url", href: "" });
});

it("recognizes an unhinted page id from the catalogue while keeping generic entries as Entry", () => {
  const pages = [{ id: "page-1", title: "About", status: "published" as const }];
  expect(menuTargetEditorKind({ target: { kind: "entryRef", entryId: "page-1" }, pages })).toBe("page");
  expect(menuTargetEditorKind({ target: { kind: "entryRef", entryId: "post-1" }, pages })).toBe("entryRef");
});

it("retains the last-known path during a catalogue failure and drops it when a different page is selected", () => {
  const target = { kind: "entryRef" as const, entryId: "page-1", entryType: "page", lastKnownHref: "/about" };
  expect(pageItemsForSave({ items: [{ id: "about", target }] })[0]!.target).toEqual(target);
  expect(pageTargetForChoice({ entryId: "page-2", previous: target })).toEqual({ kind: "entryRef", entryId: "page-2", entryType: "page" });
  expect(targetForKind({ kind: "page", prev: { kind: "url", href: "/about" } })).toEqual({
    kind: "entryRef", entryId: "", entryType: "page", lastKnownHref: "/about",
  });
});

it("respects an explicit non-page content type even when its id appears in the page catalogue", () => {
  const target = { kind: "entryRef" as const, entryId: "same-id", entryType: "recipe" };
  const pages = [{ id: "same-id", title: "About", status: "published" as const }];

  expect(menuTargetEditorKind({ target, pages })).toBe("entryRef");
  expect(hasPageLinks({ items: [{ id: "recipe", target }] })).toBe(false);
});

it("finds a nested page reference under an explicitly non-page parent", () => {
  const parent: PageMenuTarget = { kind: "entryRef", entryId: "recipe-1", entryType: "recipe" };
  const child: PageMenuTarget = { kind: "entryRef", entryId: "page-1", entryType: "page" };
  expect(hasPageLinks({ items: [{
    id: "recipe", target: parent,
    children: [{ id: "about", target: child }],
  }] })).toBe(true);
});

it("preserves an existing page path snapshot ahead of an old generic URL", () => {
  expect(targetForKind({ kind: "page", prev: {
    kind: "entryRef", entryId: "page-1", entryType: "page", lastKnownHref: "/current", href: "/stale",
  } })).toEqual({ kind: "entryRef", entryId: "page-1", entryType: "page", lastKnownHref: "/current" });
});

it("saves an unfinished Page choice with an empty id and no guessed URL", () => {
  const target: PageMenuTarget = { kind: "entryRef", entryType: "page" };
  expect(pageItemsForSave({ items: [{ id: "unfinished", target }] })).toEqual([
    { id: "unfinished", target: { kind: "entryRef", entryId: "", entryType: "page" } },
  ]);
});

it("uses translated fallback text for a missing page that has no menu label", () => {
  expect(pageLinkState({ entryId: "missing", pages: [], t: (key) => `translated:${key}` })).toEqual({
    value: "missing", unavailable: true,
    choices: [{ id: "", title: "translated:Choose a page…" }, { id: "missing", title: "translated:Page not published" }],
  });
});

it("leaves an empty picker available while the page catalogue is unknown", () => {
  expect(pageLinkState({ t: (key) => key })).toEqual({
    value: "", unavailable: false, choices: [{ id: "", title: "Choose a page…" }],
  });
});

it.each([
  { entryId: undefined, label: undefined, pages: undefined, value: "", unavailable: false, missing: [] },
  { entryId: "", label: undefined, pages: [], value: "", unavailable: false, missing: [] },
  { entryId: "missing", label: "Saved label", pages: undefined, value: "missing", unavailable: false,
    missing: [{ id: "missing", title: "Saved label" }] },
  { entryId: "missing", label: "", pages: [], value: "missing", unavailable: true,
    missing: [{ id: "missing", title: "translated:Page not published" }] },
  { entryId: "chosen", label: "Old label", pages: [{ id: "chosen", title: "Published", status: "published" as const }],
    value: "chosen", unavailable: false, missing: [] },
  { entryId: "chosen", label: "Old label", pages: [{ id: "chosen", title: "Draft", status: "draft" as const }],
    value: "chosen", unavailable: true, missing: [] },
])("pins picker defaults, availability and missing choices: %j", ({ entryId, label, pages, value, unavailable, missing }) => {
  expect(pageLinkState({ entryId, label, pages, t: (key) => `translated:${key}` })).toEqual({
    value,
    unavailable,
    choices: [{ id: "", title: "translated:Choose a page…" }, ...missing, ...(pages ?? [])],
  });
});

it("updates a nested legacy selection with the current public path, leaving an explicitly non-page sibling alone", () => {
  const legacy: PageMenuTarget = { kind: "entryRef", entryId: "about", lastKnownHref: "/old" };
  const article: PageMenuTarget = { kind: "entryRef", entryId: "about", entryType: "post" };
  const children = [{ id: "page", target: legacy }, { id: "post", target: article }];
  const root = { id: "root", target: { kind: "url" as const, href: "/" }, children };
  expect(pageItemsForSave({ items: [root], pages: [{ id: "about", title: "About", status: "published", publicPath: "/new" }] }))
    .toEqual([{ ...root, children: [
      { id: "page", target: { kind: "entryRef", entryId: "about", entryType: "page", lastKnownHref: "/new" } },
      { id: "post", target: article },
    ] }]);
  expect(legacy.lastKnownHref).toBe("/old");
});
