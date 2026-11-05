import { expect, test } from "vitest";
import { stripHtmlPresentation } from "../strip-html-presentation.js";

test("removes presentation while preserving the exact retained sentinel and functional hooks", () => {
  const sentinel = '<link rel="stylesheet" href="../css/theme.css" />';
  const functional = '<form class="signup" data-form="join" hidden><input id="email" required></form><!-- embed --><script src="lightbox.js"></script>';
  const html = `<!doctype html><html><head>${sentinel}<link rel="alternate STYLESHEET" href="old.css"><style>body{color:red}</style></head><body style="color:red">${functional}</body></html>`;
  expect(stripHtmlPresentation({ html }, { preservedStylesheetHrefs: ["../css/theme.css"] }))
    .toBe(`<!doctype html><html><head>${sentinel}</head><body >${functional}</body></html>`);
  expect(stripHtmlPresentation({ html })).not.toContain(sentinel);
});

test("strips template content, nested attributes and mixed styles without damaging scripts or SVG", () => {
  const html = '<template><style>.a{}</style><div STYLE="a:b"><span style=c:d>x</span></div></template><svg style="fill:red"><path d="M0 0"/></svg><script>const s = "<style>x</style>";</script>';
  expect(stripHtmlPresentation({ html })).toBe('<template><div ><span >x</span></div></template><svg ><path d="M0 0"/></svg><script>const s = "<style>x</style>";</script>');
});

test("handles fragments, missing hrefs, malformed markup and repeated style regions", () => {
  expect(stripHtmlPresentation({ html: '<noscript><style>body{color:red}</style><p style="color:red">x</p></noscript>' }))
    .toBe('<noscript><p >x</p></noscript>');
  expect(stripHtmlPresentation({ html: '<link rel=stylesheet><style>x</style><p style="a:b">x<style>y</style>' }))
    .toBe('<p >x');
  const html = '<!-- keep --><div class=x data-consent=necessary hidden>ok</div>';
  expect(stripHtmlPresentation({ html })).toBe(html);
});
