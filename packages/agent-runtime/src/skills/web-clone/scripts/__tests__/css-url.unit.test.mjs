import { describe, expect, it } from "vitest";
import { replaceCssUrls } from "../lib/css-url.mjs";

// lib/css-url.mjs documents its contract as "the same result as
// text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, replacer)", edge cases included, optionally
// restricted to references `accept` admits. That regex is the independent oracle here.
const ORACLE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const tag = (match, quote, ref) => `<${quote}|${ref}|${match.length}>`;
const viaRegex = (text) => text.replace(ORACLE, tag);
const viaScanner = (text) => replaceCssUrls({ text, replacer: tag });

describe("replaceCssUrls", () => {
  it.each([
    ["an unquoted reference", "a{b:url(x.png)}"],
    ["a quoted reference with inner and outer spaces", "a{b:url( 'x y.png' )}"],
    ["an empty quoted reference", "a{b:url('')}"],
    ["mismatched quotes", "a{b:url('x.png\")}"],
    ["a quoted reference not closed by a parenthesis", "a{b:url('x.png' ;}"],
    ["a quoted reference closed only after other text", "a{b:url('x.png' y)}"],
    ["whitespace-only content", "a{b:url(  )}"],
    ["no content at all", "a{b:url()}"],
    ["an unterminated unquoted reference", "a{b:url(x.png"],
    ["an unquoted reference cut by a quote", "a{b:url(x'y)}"],
    ["two references sharing one scan run", "url(a)url( b )URL('c')"],
    ["an opener inside a rejected reference", "url('a url(b)"],
  ])("matches the documented regex on %s", (_case, text) => {
    expect(viaScanner(text)).toBe(viaRegex(text));
  });

  it("matches the documented regex on 3000 seeded random strings over the CSS url alphabet", () => {
    const alphabet = ["url(", "URL(", "(", ")", "'", '"', " ", "\t", "a", "b.png", "/"];
    let seed = 0x2f6b1;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
    for (let n = 0; n < 3000; n += 1) {
      let text = "";
      const length = next() % 14;
      for (let i = 0; i < length; i += 1) text += alphabet[next() % alphabet.length];
      expect(viaScanner(text), JSON.stringify(text)).toBe(viaRegex(text));
    }
  });

  it("treats a reference accept rejects as no match, so its text is copied unchanged", () => {
    const text = "url(keep.png) url('swap.png') url(data:x)";
    const accept = (ref) => !ref.startsWith("data:") && ref !== "keep.png";
    const out = replaceCssUrls({ text, replacer: (_match, quote, ref) => `url(${quote}/cache/${ref}${quote})` }, { accept });
    expect(out).toBe("url(keep.png) url('/cache/swap.png') url(data:x)");
  });
});
