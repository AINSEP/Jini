import { describe, expect, it } from "vitest";
import { extractPlainTextFromHtml } from "../html-plain-text.js";

/**
 * @file Golden rows for the HTML-body plain-text extractor. The rows were first run against the
 * test-support copy this module replaced and agreed with it row for row (plus a 20k-input random
 * differential), so they pin the behaviour hosts relied on before the extractor moved here.
 */
const TABLE: ReadonlyArray<readonly [string, string, string]> = [
  ["named and numeric entities", "<p>A&amp;B &lt;x&gt; &#39;q&#39; &#x1F600; &mdash; &unknown; &constructor;</p>", " A&B <x> 'q' 😀 — &unknown; &constructor; "],
  ["out-of-range entities pass through", "<p>&#1114112; &#x110000; &#55296;</p>", " &#1114112; &#x110000; &#55296; "],
  ["nested lists", "<ul><li>One<ul><li>Two</li></ul></li><li>Three</li></ul>", "  One  Two    Three  "],
  ["br and hr", "Line one<br>Line two<br/>Line three<hr>End", "Line one Line two Line three End"],
  ["script and style content is dropped", "<style>.a{color:red}</style><p>Prose</p><script>secret()</script>after", "  Prose  after"],
  ["unclosed tag keeps its text", "<p>Before <b unclosed", " Before <b unclosed"],
  ["stray angle bracket pair", "<p>a < b and c > d</p>", " a   d "],
  ["unclosed detail header keeps the remainder", '<div class="post-detail-header">Unclosed<p>Body</p>', " Unclosed Body "],
  [
    "nested detail headers are removed, prose around them kept",
    'Before<div class="x post-detail-header"><div>Title</div>Date</div>Middle<header class="post-detail-header">Other</header>After',
    "Before Middle After",
  ],
  [
    "distinct class tokens are prose",
    '<p>Before</p><div class="post-detail-header-extra">Kept</div><div class="x-post-detail-header">Kept</div>',
    " Before  Kept  Kept ",
  ],
];

describe("extractPlainTextFromHtml", () => {
  for (const [name, html, expected] of TABLE) {
    it(name, () => {
      expect(extractPlainTextFromHtml({ html })).toBe(expected);
    });
  }
});
