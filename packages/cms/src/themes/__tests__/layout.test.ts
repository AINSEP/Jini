import assert from "node:assert/strict";
import { test } from "vitest";

import { ENGINE_SUBFOLDERS, THEME_CATALOG_DIR, TRASH_DIR_NAME, isPageFilePath, isPartialFilePath, resolveThemeLayout } from "../layout.js";

// Mutations: wrong v1 stylesheet, v2 using v1's table, loose v1 page includes,
// v1 page prefix for v2, nested v1 partials, or root v2 partials.
test("resolveThemeLayout: v1 (apiVersion absent) resolves the flat layout", () => {
  const layout = resolveThemeLayout({}, { apiVersion: undefined });
  assert.equal(layout.pagesDir, "pages");
  assert.equal(layout.partialsDir, "");
  assert.equal(layout.scriptsDir, "js");
  assert.equal(layout.cssDir, "css");
  assert.equal(layout.stylesheetFilename, "styles.css");
  assert.equal(layout.stylesheetPath, "css/styles.css");
  assert.equal(layout.indexPagePath, "pages/index.html");
  assert.deepEqual(layout.requiredFiles, ["pages/index.html", "theme.json", "tokens.json"]);
});

test("resolveThemeLayout: v2 (apiVersion: 2) resolves the nested layout", () => {
  const layout = resolveThemeLayout({}, { apiVersion: 2 });
  assert.equal(layout.pagesDir, "render/pages");
  assert.equal(layout.partialsDir, "render/partials");
  assert.equal(layout.scriptsDir, "scripts");
  assert.equal(layout.cssDir, "css");
  assert.equal(layout.stylesheetFilename, "theme.css");
  assert.equal(layout.stylesheetPath, "css/theme.css");
  assert.equal(layout.indexPagePath, "render/pages/index.html");
  assert.deepEqual(layout.requiredFiles, ["render/pages/index.html", "theme.json", "tokens.json"]);
});

test("isPageFilePath: v1 matches pages/ prefix, not render/pages/", () => {
  assert.equal(isPageFilePath({ relativePath: "pages/about.html" }, { apiVersion: undefined }), true);
  assert.equal(isPageFilePath({ relativePath: "pages/index.html" }, { apiVersion: undefined }), true);
  assert.equal(isPageFilePath({ relativePath: "render/pages/about.html" }, { apiVersion: undefined }), false);
  assert.equal(isPageFilePath({ relativePath: "css/pages/x.css" }, { apiVersion: undefined }), false);
});

test("isPageFilePath: v2 matches render/pages/ prefix, not bare pages/", () => {
  assert.equal(isPageFilePath({ relativePath: "render/pages/about.html" }, { apiVersion: 2 }), true);
  assert.equal(isPageFilePath({ relativePath: "render/pages/index.html" }, { apiVersion: 2 }), true);
  assert.equal(isPageFilePath({ relativePath: "pages/about.html" }, { apiVersion: 2 }), false);
});

test("isPartialFilePath: v1 matches a root .html file with no slash, not a nested one", () => {
  assert.equal(isPartialFilePath({ relativePath: "nav.html" }, { apiVersion: undefined }), true);
  assert.equal(isPartialFilePath({ relativePath: "footer-minimal.html" }, { apiVersion: undefined }), true);
  assert.equal(isPartialFilePath({ relativePath: "render/partials/nav.html" }, { apiVersion: undefined }), false);
  assert.equal(isPartialFilePath({ relativePath: "pages/index.html" }, { apiVersion: undefined }), false);
  assert.equal(isPartialFilePath({ relativePath: "nav.json" }, { apiVersion: undefined }), false);
});

test("isPartialFilePath: v2 matches render/partials/*.html, not a bare root .html file", () => {
  assert.equal(isPartialFilePath({ relativePath: "render/partials/nav.html" }, { apiVersion: 2 }), true);
  assert.equal(isPartialFilePath({ relativePath: "render/partials/footer-minimal.html" }, { apiVersion: 2 }), true);
  assert.equal(isPartialFilePath({ relativePath: "nav.html" }, { apiVersion: 2 }), false);
  assert.equal(isPartialFilePath({ relativePath: "render/pages/index.html" }, { apiVersion: 2 }), false);
});

// Mutations: change any disk constant or any engine subfolder.
test("disk constants preserve recovery, catalog and engine folder names", () => {
  assert.equal(TRASH_DIR_NAME, ".trash");
  assert.deepEqual(ENGINE_SUBFOLDERS, ["declarative", "templated", "handlebars", "static"]);
  assert.equal(THEME_CATALOG_DIR, "__original-themes__");
});
