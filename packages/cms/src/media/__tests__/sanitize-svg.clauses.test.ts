import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { MediaValidationError } from "../types.js";
import { sanitizeSvg } from "../sanitize-svg.js";

/**
 * One minimal payload per unsafe clause of `sanitize-svg.ts` (Stryker L4: 28 survivors in the CSS
 * regex, the attribute hook and the raster-data-URI condition). Each case pairs with a safe
 * near-twin that must survive, so neither "strip everything" nor "strip nothing" passes.
 */

const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`;
async function clean(inner: string) {
  const bytes = await sanitizeSvg({ bytes: new TextEncoder().encode(svg(inner)) });
  return new JSDOM(new TextDecoder().decode(bytes), { contentType: "image/svg+xml" }).window.document;
}
const PNG_1PX = "iVBORw0KGgo=";
const GIF_1PX = "R0lGODlhAQABAAAAACw=";

describe("style attribute CSS", () => {
  it.each([
    ["external url()", "fill:url(https://evil.example/p)"],
    ["protocol-relative url()", "fill:url(//evil.example/p)"],
    ["url with spaces before (", "fill:url  (https://evil.example/p)"],
    ["UPPERCASE URL()", "fill:URL(https://evil.example/p)"],
    ["image-set()", "fill:image-set('https://evil.example/i')"],
    ["-webkit-image-set()", "fill:-webkit-image-set('https://evil.example/i')"],
    ["src()", "fill:src('https://evil.example/i')"],
    ["expression()", "width:expression(alert(1))"],
    ["@import", "@import 'x.css'"],
    ["backslash escape", "fill:u\\72l(https://evil.example/p)"],
    ["comment obfuscation", "fill:u/**/rl(https://evil.example/p)"],
    ["local url followed by an external one", "fill:url(#a);stroke:url(https://evil.example/p)"],
    ["unbalanced quotes on a local id", "fill:url('#a\")"],
  ])("%s is stripped", async (_label, style) => {
    expect((await clean(`<path d="M0 0" style="${style.replace(/"/g, "&quot;")}"/>`)).querySelector("path")?.getAttribute("style")).toBeNull();
  });

  it.each([
    ["plain colour", "fill:#123456"],
    ["local paint server", "fill:url(#paint)"],
    ["quoted local paint server with inner spaces", "fill:url( '#paint' )"],
    ["double-quoted local id with dots and colons", 'fill:url("#a:b.c-d")'],
    ["several local refs", "fill:url(#a);stroke:url(#b)"],
  ])("%s is kept verbatim", async (_label, style) => {
    expect((await clean(`<path d="M0 0" style="${style.replace(/"/g, "&quot;")}"/>`)).querySelector("path")?.getAttribute("style")).toBe(style);
  });

  it("an unsafe CSS value on a non-style presentation attribute is stripped too", async () => {
    const doc = await clean(`<path d="M0 0" fill="url(https://evil.example/p)" stroke="url(#ok)"/>`);
    expect(doc.querySelector("path")?.getAttribute("fill")).toBeNull();
    expect(doc.querySelector("path")?.getAttribute("stroke")).toBe("url(#ok)");
  });
});

describe("<style> element CSS", () => {
  it("unsafe text is emptied, safe text is kept", async () => {
    const doc = await clean(`<style>.a{fill:url(#p)}</style><style>.b{fill:url(https://evil.example/p)}</style>`);
    const [safe, unsafe] = [...doc.querySelectorAll("style")];
    expect(safe?.textContent).toBe(".a{fill:url(#p)}");
    expect(unsafe?.textContent).toBe("");
  });
});

describe("href/src references", () => {
  it.each([
    ["href", `<use href="#mark"/>`],
    ["xlink:href", `<use xlink:href="#mark"/>`],
    ["href with surrounding whitespace", `<use href="  #mark  "/>`],
  ])("a local %s is kept", async (_label, inner) => {
    const use = (await clean(`<defs><path id="mark" d="M0 0"/></defs>${inner}`)).querySelector("use")!;
    expect(use.getAttribute("href") ?? use.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toMatch(/#mark/);
  });

  it.each([
    ["relative file", "other.svg#mark"],
    ["absolute https", "https://evil.example/x.svg#mark"],
    ["bare id without #", "mark"],
    ["# followed by a digit", "#1mark"],
    ["# with trailing junk", "#mark junk"],
    ["leading-space javascript:", " javascript:alert(1)"],
  ])("%s reference on <use> is dropped", async (_label, href) => {
    const use = (await clean(`<use href="${href}"/>`)).querySelector("use");
    expect(use?.getAttribute("href") ?? null).toBeNull();
  });

  it("a real raster data URI is kept only on <image>", async () => {
    const doc = await clean(`<image href="data:image/png;base64,${PNG_1PX}"/><use href="data:image/png;base64,${PNG_1PX}"/>`);
    expect(doc.querySelector("image")?.getAttribute("href")).toBe(`data:image/png;base64,${PNG_1PX}`);
    expect(doc.querySelector("use")?.getAttribute("href") ?? null).toBeNull();
  });

  it.each([
    ["declared png, gif bytes", `data:image/png;base64,${GIF_1PX}`],
    ["svg data URI", "data:image/svg+xml;base64,PHN2Zy8+"],
    ["non-base64 data URI", "data:image/png,abc"],
    ["png with trailing junk", `data:image/png;base64,${PNG_1PX}"onload`],
    ["external https image", "https://evil.example/x.png"],
  ])("<image> with %s is dropped", async (_label, href) => {
    const doc = await clean(`<image href="${href.replace(/"/g, "&quot;")}"/>`);
    expect(doc.querySelector("image")?.getAttribute("href") ?? null).toBeNull();
  });

  it("a gif data URI that really is a gif is kept (sniffed type must equal declared type, case-insensitive)", async () => {
    const doc = await clean(`<image href="data:IMAGE/GIF;base64,${GIF_1PX}"/>`);
    expect(doc.querySelector("image")?.getAttribute("href")).toBe(`data:IMAGE/GIF;base64,${GIF_1PX}`);
  });
});

describe("event handlers and xml:base", () => {
  it("on* handlers in any case and xml:base are removed; ordinary attributes stay", async () => {
    const doc = await clean(`<path d="M0 0" onclick="alert(1)" ONMOUSEOVER="alert(2)" xml:base="https://evil.example/" class="ok" data-x="1"/>`);
    const path = doc.querySelector("path")!;
    expect([...path.attributes].map((a) => a.name).sort()).toEqual(["class", "d"]);
  });
});

describe("document-level refusals carry their specific message", () => {
  it.each([
    [svg("<font/>").replace("<font/>", '<font><font-face font-family="x"/></font>'), "SVG fonts are not allowed"],
    ['<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>', "SVG DTDs and entities are not allowed"],
    ['<!entity x "y"><svg xmlns="http://www.w3.org/2000/svg"/>', "SVG DTDs and entities are not allowed"],
    ['<svg xmlns="http://example.com/not-svg"/>', "invalid SVG document"],
    ["<svg><unclosed></svg>", "invalid SVG document"],
  ])("%s → %s", async (source, message) => {
    const attempt = sanitizeSvg({ bytes: new TextEncoder().encode(source) });
    await expect(attempt).rejects.toBeInstanceOf(MediaValidationError);
    await expect(attempt).rejects.toMatchObject({ message });
  });

  it("invalid UTF-8 → SVG must be valid UTF-8", async () => {
    await expect(sanitizeSvg({ bytes: new Uint8Array([0x3c, 0xff, 0xfe]) })).rejects.toMatchObject({ message: "SVG must be valid UTF-8" });
  });
});
