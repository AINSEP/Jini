import { expect, test } from "vitest";
import { inheritedTemplateSource, isRewritableCssPath, previewCss, trustedPreviewRevision } from "../theme-static-assets.js";

test("a stamped revision wins; otherwise only a well-formed URL revision an admin previewed", () => {
  const trusted = ({ revision }: { revision: string }) => revision === "r1";
  expect(trustedPreviewRevision({ requestedRevision: "r1", localsRevision: "r0" }, { isAuthenticatedPreviewRevision: trusted })).toBe("r0");
  expect(trustedPreviewRevision({ requestedRevision: "r1", localsRevision: undefined }, { isAuthenticatedPreviewRevision: trusted })).toBe("r1");
  expect(trustedPreviewRevision({ requestedRevision: "r2", localsRevision: undefined }, { isAuthenticatedPreviewRevision: trusted })).toBeUndefined();
  expect(trustedPreviewRevision({ requestedRevision: "r1", localsRevision: 7 }, { isAuthenticatedPreviewRevision: trusted })).toBeUndefined();
});

test("only css outside dot folders is rewritten, and only root-relative theme references move", () => {
  expect(isRewritableCssPath({ relativePath: "css/A.CSS" })).toBe(true);
  expect(isRewritableCssPath({ relativePath: ".git/a.css" })).toBe(false);
  expect(previewCss({ css: `@import "/theme-assets/a.css"; a{background:url( '/theme-assets/i.png')} b{background:url(https://x/theme-assets/j.png)}`, revision: "r 1" }))
    .toBe(`@import "/theme-preview-assets/r%201/a.css"; a{background:url( '/theme-preview-assets/r%201/i.png')} b{background:url(https://x/theme-assets/j.png)}`);
});

test("inherited sources answer GET/HEAD for their own theme only; malformed paths fall through", () => {
  const themes = [{ dir: "/t/a", inheritedTemplateSources: { "templates/page.liquid": "<p>x</p>" } }];
  expect(inheritedTemplateSource({ themes, themeDir: "/t/a", url: "/templates/page.liquid?v=1", method: "HEAD" })).toBe("<p>x</p>");
  expect(inheritedTemplateSource({ themes, themeDir: "/t/b", url: "/templates/page.liquid", method: "GET" })).toBeUndefined();
  expect(inheritedTemplateSource({ themes, themeDir: "/t/a", url: "/templates/page.liquid", method: "POST" })).toBeUndefined();
  expect(inheritedTemplateSource({ themes, themeDir: "/t/a", url: "/%E0", method: "GET" })).toBeUndefined();
});

test("malformed request revisions are rejected before consulting the trusted preview cache", () => {
  const seen: string[] = [];
  const trust = ({ revision }: { revision: string }) => { seen.push(revision); return true; };
  for (const revision of ["", "../preview", "r".repeat(101)]) {
    expect(trustedPreviewRevision({ requestedRevision: revision, localsRevision: null }, { isAuthenticatedPreviewRevision: trust })).toBeUndefined();
  }
  expect(seen).toEqual([]);
  expect(trustedPreviewRevision({ requestedRevision: "cache-missing", localsRevision: undefined }, {})).toBeUndefined();
  const maxLength = "r".repeat(100);
  expect(trustedPreviewRevision({ requestedRevision: maxLength, localsRevision: undefined }, { isAuthenticatedPreviewRevision: trust })).toBe(maxLength);
  expect(seen).toEqual([maxLength]);
  expect(isRewritableCssPath({ relativePath: "themes/header.js" })).toBe(false);
  expect(isRewritableCssPath({ relativePath: "themes\\.private\\style.css" })).toBe(false);
});
