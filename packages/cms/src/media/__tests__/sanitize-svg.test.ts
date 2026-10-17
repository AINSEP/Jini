import assert from "node:assert/strict";
import { test } from "vitest";
import { JSDOM } from "jsdom";
import { sanitizeSvg } from "../sanitize-svg.js";

const encode = (source: string) => new TextEncoder().encode(source);
const parse = (bytes: Uint8Array) => new JSDOM(new TextDecoder().decode(bytes), { contentType: "image/svg+xml" }).window.document;

test("malicious SVG loses executable content, external references, and animated href changes", async () => {
  const document = parse(await sanitizeSvg({ bytes: encode(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
    <script>alert(1)</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">bad</div></foreignObject>
    <a href="javascript:alert(1)"><path d="M0 0h10v10z"/></a>
    <image href="https://evil.example/track"/><image href="data:image/svg+xml;base64,PHN2Zy8+"/><image href="data:image/png;base64,PHN2Zy8+"/>
    <use href="other.svg#logo"/><use xlink:href="//evil.example/logo.svg#logo"/>
    <path fill="url(https://evil.example/paint)" style="filter:url(//evil.example/filter)"/>
    <style>@import 'https://evil.example/style.css';</style><path style="fill:image-set('https://evil.example/image')"/>
    <animate attributeName="href" values="#logo;https://evil.example/x"/><set attributeName="onload" to="alert(1)"/>
  </svg>`) }));
  assert.equal(document.querySelector("script, foreignObject, animate, set"), null);
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      assert.doesNotMatch(attribute.name, /^on/i);
      assert.doesNotMatch(attribute.value, /javascript:|evil\.example|data:image\/(?:svg|png)/i);
    }
  }
  assert.doesNotMatch(document.documentElement.textContent ?? "", /@import|alert\(1\)|evil\.example/);
});

test("a normal logo preserves viewBox, paths, styling, gradients, local use and raster data images", async () => {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32" width="64" height="32">
    <style>.logo { fill: url(#paint); stroke: #123456; }</style>
    <defs><linearGradient id="paint"><stop offset="0" stop-color="#123456"/><stop offset="1" stop-color="#abcdef"/></linearGradient><path id="mark" d="M0 0h32v32H0z"/></defs>
    <use href="#mark" class="logo" transform="translate(16 0)"/>
    <path d="M1 1h2v2z" style="fill:#123456"/>
    <image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>
  </svg>`;
  const before = parse(encode(source));
  const clean = await sanitizeSvg({ bytes: encode(source) });
  const after = parse(clean);
  assert.equal(after.documentElement.getAttribute("viewBox"), before.documentElement.getAttribute("viewBox"));
  assert.equal(after.documentElement.getAttribute("width"), "64");
  assert.equal(after.documentElement.getAttribute("height"), "32");
  for (const selector of ["style", "defs", "use", "svg > path", "image"]) {
    assert.equal(after.querySelector(selector)?.outerHTML, before.querySelector(selector)?.outerHTML);
  }
  assert.deepEqual(await sanitizeSvg({ bytes: clean }), clean, "sanitizing again must be stable for deduplication");
});

for (const source of [
  '<svg xmlns="http://www.w3.org/2000/svg"><font><font-face font-family="bad"/></font></svg>',
  '<!DOCTYPE svg [<!ENTITY x "bad">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><broken></svg>',
  '<html xmlns="http://www.w3.org/1999/xhtml"/>',
]) {
  test(`rejects fonts, DTDs and malformed/non-SVG XML: ${source.slice(0, 50)}`, async () => {
    await assert.rejects(() => sanitizeSvg({ bytes: encode(source) }));
  });
}

test("encoded URI schemes and obfuscated CSS cannot hide external loads", async () => {
  const document = parse(await sanitizeSvg({ bytes: encode(String.raw`<svg xmlns="http://www.w3.org/2000/svg"><a href="java&#x73;cript:alert(1)"/><path style="fill:u\72l(https://evil.example/p)"/><style>.x{fill:u/**/rl(https://evil.example/p)}</style></svg>`) }));
  assert.equal(document.querySelector("a")?.getAttribute("href"), null);
  assert.equal(document.querySelector("path")?.getAttribute("style"), null);
  assert.equal(document.querySelector("style")?.textContent, "");
});
