import { describe, expect, it } from "vitest";

import { isOpenFileLoaded, keepsOpenFileSelected } from "../hooks/theme-explore-open-file.hooks.js";

/**
 * @file `theme-explore-open-file.hooks.ts` in isolation — no React, no port. `use-theme-explore.hooks.unit.test.ts`
 * covers these predicates wired into the hook's content refresh.
 */

describe("isOpenFileLoaded", () => {
  it("is true when the loaded marker names the open theme and path", () => {
    expect(isOpenFileLoaded({ loaded: { themeId: "basic", path: "a.css" }, themeId: "basic", selected: "a.css" })).toBe(true);
  });

  it("is false when nothing has been loaded", () => {
    expect(isOpenFileLoaded({ loaded: null, themeId: "basic", selected: "a.css" })).toBe(false);
  });

  it("is false when the marker is for another theme at the same path", () => {
    expect(isOpenFileLoaded({ loaded: { themeId: "other", path: "a.css" }, themeId: "basic", selected: "a.css" })).toBe(false);
  });

  it("is false when the marker is for another path", () => {
    expect(isOpenFileLoaded({ loaded: { themeId: "basic", path: "b.css" }, themeId: "basic", selected: "a.css" })).toBe(false);
  });

  it("is false for a null selection", () => {
    expect(isOpenFileLoaded({ loaded: { themeId: "basic", path: "a.css" }, themeId: "basic", selected: null })).toBe(false);
  });
});

describe("keepsOpenFileSelected", () => {
  const loadedA = { themeId: "basic", path: "a.css" };
  const clean = { selected: "a.css", source: "x", savedSource: "x", loadedFile: loadedA };
  const dirty = { ...clean, source: "typed" };

  it("keeps a file that is still listed", () => {
    expect(keepsOpenFileSelected({ serverFiles: [{ path: "a.css" }], open: clean, themeId: "basic" })).toBe(true);
  });

  it("lets a removed clean file go", () => {
    expect(keepsOpenFileSelected({ serverFiles: [{ path: "b.css" }], open: clean, themeId: "basic" })).toBe(false);
  });

  it("keeps a removed file whose loaded buffer holds unsaved text", () => {
    expect(keepsOpenFileSelected({ serverFiles: [], open: dirty, themeId: "basic" })).toBe(true);
  });

  it("lets a removed file go when its differing buffer was never loaded from it", () => {
    expect(keepsOpenFileSelected({ serverFiles: [], open: { ...dirty, loadedFile: null }, themeId: "basic" })).toBe(false);
  });

  it("lets a removed file go when its buffer was loaded for another theme", () => {
    expect(keepsOpenFileSelected({ serverFiles: [], open: dirty, themeId: "other" })).toBe(false);
  });
});
