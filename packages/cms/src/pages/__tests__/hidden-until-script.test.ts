import assert from "node:assert/strict";
import { test } from "vitest";

import { describeScriptRevealedContent, findScriptRevealedContent, MAX_REVEAL_FINDINGS } from "../hidden-until-script.js";

/**
 * @file Markup copied from another site that stays invisible because the script that revealed it
 * was not copied (Luvira import, 2026-10-08: a washed-out hero). Page HTML never runs the source's
 * scroll-reveal script, so `opacity:0` / `visibility:hidden` set for it is permanent. These are the
 * pure scanner cases; the host keeps the page-tool tests that check the write still succeeds with a
 * `warning`.
 */

test("an inline opacity:0 or visibility:hidden style is reported with its element", () => {
  const findings = findScriptRevealedContent({
    html:
      `<section data-agent-element="hero" data-agent-role="region">` +
      `<h1 class="hero-title" style="opacity:0;transform:translate3d(0,40px,0)">We hire</h1>` +
      `<p style="visibility: hidden">Lede</p>` +
      `<div style="opacity: 0.0">Card</div></section>`,
  });
  assert.equal(findings.length, 3);
  assert.match(findings[0]!, /<h1 class="hero-title">.*inline style opacity:0/);
  assert.match(findings[1]!, /<p>.*inline style visibility: hidden/);
  assert.match(findings[2]!, /<div>.*inline style opacity: 0\.0/);
});

test("a partial opacity is a design choice, not hidden content", () => {
  assert.deepEqual(findScriptRevealedContent({ html: `<p style="opacity:0.5">a</p><p style="opacity: 0.05">b</p><p style="opacity:1">c</p>` }), []);
});

test("scroll-reveal library attributes and classes are reported; look-alike class names are not", () => {
  const findings = findScriptRevealedContent({
    html: `<div data-aos="fade-up">a</div><div data-sal="slide-up">b</div><div class="wow fadeInUp">c</div><div class="wowza">d</div><div data-sr-id="3">e</div>`,
  });
  assert.equal(findings.length, 4);
  assert.match(findings[0]!, /<div>.*data-aos/);
  assert.match(findings[1]!, /<div>.*data-sal/);
  assert.match(findings[2]!, /<div class="wow fadeInUp">.*class "wow"/);
  assert.match(findings[3]!, /<div>.*data-sr-id/);
});

test("a bare (valueless) reveal attribute is reported, and a bare class attribute is not mistaken for a reveal class", () => {
  const findings = findScriptRevealedContent({ html: `<section data-aos>a</section><p class>b</p><div data-sal=slide-up>c</div>` });
  assert.deepEqual(findings, [
    "<section> has data-aos (a scroll-reveal library attribute)",
    "<div> has data-sal (a scroll-reveal library attribute)",
  ]);
});

test("a <style> rule that hides a reveal-named selector is reported; keyframes and ordinary hidden overlays are not", () => {
  const findings = findScriptRevealedContent({
    html:
      `<style>` +
      `@keyframes rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1 } }` +
      `.overlay { opacity: 0 } .card:hover .overlay { opacity: 1 }` +
      `.lv-reveal, .fade-in-up { opacity:0; transform: translateY(24px) }` +
      `.lv-reveal.is-in { opacity: 1 }` +
      `</style><section data-agent-element="a" data-agent-role="region">x</section>`,
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0]!, /<style> rule "\.lv-reveal, \.fade-in-up"/);
});

test("markup inside an HTML comment is not content and is not reported", () => {
  assert.deepEqual(findScriptRevealedContent({ html: `<!-- <div style="opacity:0" data-aos="x"> -->` }), []);
});

test("findings stop at the cap with a count of the rest", () => {
  const html = Array.from({ length: MAX_REVEAL_FINDINGS + 3 }, (_, i) => `<p data-aos="fade" id="p${i}">x</p>`).join("");
  const findings = findScriptRevealedContent({ html });
  assert.equal(findings.length, MAX_REVEAL_FINDINGS + 1);
  assert.equal(findings.at(-1), "...and 3 more.");
});

test("describeScriptRevealedContent returns undefined for clean markup", () => {
  assert.equal(describeScriptRevealedContent({ html: `<section><h1>Hi</h1></section>` }), undefined);
});

test("describeScriptRevealedContent names every finding in one model-facing warning", () => {
  const warning = describeScriptRevealedContent({ html: `<h1 style="opacity:0">We hire</h1><div data-aos="fade-up">a</div>` });
  assert.equal(typeof warning, "string");
  assert.match(warning!, /^Written, but some of this markup stays invisible/);
  assert.match(warning!, /<h1> has inline style opacity:0; <div> has data-aos \(a scroll-reveal library attribute\)$/);
});
