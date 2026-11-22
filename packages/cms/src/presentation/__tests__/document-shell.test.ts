import assert from "node:assert/strict";
import { test } from "vitest";
import { renderBareDocument, renderDocumentShell } from "../document-shell.js";

test("bare fragments preserve exact bytes, escaping, head order and body assets", () => {
  assert.equal(renderBareDocument({ title: 'A & <B> "C"', body: "<p>Body</p>" }, {
    extraHead: '<meta name="description" content="raw"/>',
    documentAssets: { head: "<!--host-head-->", body: "<!--host-body-->" },
  }), '<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>A &amp; &lt;B&gt; &quot;C&quot;</title><meta name="description" content="raw"/><!--host-head--></head><body><p>Body</p><!--host-body--></body></html>');
  assert.equal(renderBareDocument({ title: "Fallback", body: "x" }, { extraHead: "<title>Fold</title>" }),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Fold</title></head><body>x</body></html>');
});

test("authored BOM and comment classify the source while returning the resolved body verbatim", () => {
  const authoredHtml = '\uFEFF <!-- authored -->\n<!DOCTYPE HTML><html><body>source</body></html>';
  const body = "<section>resolved fragment</section>";
  assert.equal(renderBareDocument({ title: "Ignored", body }, {
    authoredHtml, extraHead: "<title>Ignored</title>", documentAssets: { head: "head", body: "tail" },
  }), body);
  assert.equal(renderBareDocument({ title: "Wrapped", body: "<!doctype html>resolved" }, { authoredHtml: "<p>source</p>" }),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Wrapped</title></head><body><!doctype html>resolved</body></html>');
});

const RESET = `
  *,*::before,*::after { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; -webkit-font-smoothing: antialiased; }
  img { max-width: 100%; height: auto; }
  a { color: inherit; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

test("managed shell without a theme omits the attribute and retains exact whitespace", () => {
  assert.equal(renderDocumentShell({ title: "A & B", body: "<p>x</p>" }), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>A &amp; B</title>


<style>${RESET}</style>


</head>
<body>
<div class="site"><p>x</p></div>


</body>
</html>`);
});

test("managed themed shell suppresses fallback title and orders leading assets before host assets", () => {
  assert.equal(renderDocumentShell({ title: "Fallback", body: "<main>Body</main>" }, {
    extraHead: "<title>Fold</title>", themeFontLink: '<link href="font.css"/>', themeStyle: ":root { --a: b; }",
    themeId: 'theme"&', leadingAssets: { head: "<!--leading-head-->", body: "<!--leading-body-->" },
    documentAssets: { head: "<!--host-head-->", body: "<!--host-body-->" },
  }), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>

<title>Fold</title>
<link href="font.css"/>
<style>${RESET}:root { --a: b; }</style>
<!--leading-head-->
<!--host-head-->
</head>
<body>
<div class="site" data-theme="theme&quot;&amp;"><main>Body</main></div>
<!--leading-body-->
<!--host-body-->
</body>
</html>`);
  assert.ok(renderDocumentShell({ title: "", body: "" }, { themeId: "" }).includes(' data-theme=""'));
});
