import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * @file Static comment-hygiene regression test for `styles/see-more.css`.
 *
 * This suite runs under `environment: "jsdom"` with `css: false` (see `vitest.config.ts`) — CSS
 * imports are stubbed to nothing, and jsdom has no layout engine regardless, so nothing under
 * `components/__tests__/SeeMore.unit.test.tsx` can observe whether the clamp actually applies (its
 * own header says so explicitly). That is a real, unfixable gap for the *layout* claim.
 *
 * The specific bug this file regressions-tests is different in kind and IS observable without a
 * browser: `see-more.css` once had a documentation comment whose second paragraph was missing its
 * opening delimiter, which left it as bare text sitting directly in front of the
 * `.see-more .see-more-text {` selector. A CSS parser collects all component values up to the next
 * top-level `{` as one rule's prelude — so that stray paragraph (plus its own trailing, and by then
 * meaningless, closing delimiter) got fused onto the real selector into one unparseable prelude,
 * and per CSS's error-recovery rules the *entire* qualified rule — selector and declaration block
 * together — was silently dropped. No console error, no HMR warning: the browser simply never saw
 * `display: -webkit-box` or `-webkit-line-clamp` at all. Confirmed live via
 * `document.styleSheets`: the served sheet had 4 rules instead of 5, with `.see-more .see-more-text`
 * entirely absent.
 *
 * `stripWellFormedComments` models exactly the part of the CSS tokenizer this bug depends on: only
 * an opening delimiter that is not already inside a comment starts one, and only a matching closing
 * delimiter ends it — a closing delimiter with no open comment has no special meaning and is
 * ordinary content, exactly as a real parser treats it. Extracting rule preludes the same way a
 * parser does (text between `}` and the next `{`) turns "a rule silently vanished" into a plain
 * string assertion, which is what `toContain(".see-more .see-more-text")` checks below: if a
 * comment ever goes unbalanced again and fuses prose onto this selector, the exact string stops
 * appearing in the prelude list and this test fails — for the same reason the browser would drop
 * the rule.
 */

const CSS_PATH = path.resolve(__dirname, "../../styles/admin.css");

/**
 * Removes only well-formed comment spans, exactly as the CSS tokenizer does: a closing delimiter
 * has no effect unless a comment is currently open. An unterminated trailing comment consumes to
 * EOF, matching the CSS Syntax spec's "no error, comment runs to end of input" recovery rule.
 * @param css raw stylesheet source
 * @returns the source with only balanced comments removed; unmatched comment delimiters are left
 * as literal text, the same as a real parser would leave them
 * @complexity O(n) over the input length, single left-to-right scan
 */
function stripWellFormedComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) break; // unterminated comment: spec says it silently swallows to EOF
      i = end + 2;
      continue;
    }
    out += css[i];
    i++;
  }
  return out;
}

/**
 * Extracts each top-level rule's prelude (its selector text) the way a CSS parser does: everything
 * between a `}` (or the start of the file) and the next `{`, trimmed. Nested braces do not occur in
 * plain selector lists, so this simple split is sufficient for a flat stylesheet like this one.
 * @param strippedCss comment-stripped stylesheet source
 * @returns trimmed prelude strings, in source order
 * @complexity O(n) over the input length
 */
function extractRulePreludes(strippedCss: string): string[] {
  return strippedCss
    .split("}")
    .map((chunk) => {
      const braceIndex = chunk.indexOf("{");
      return braceIndex === -1 ? null : chunk.slice(0, braceIndex).trim();
    })
    .filter((prelude): prelude is string => prelude !== null && prelude.length > 0);
}

function declarations(block: string): Record<string, string> {
  const body = block.slice(block.indexOf("{") + 1);
  return Object.fromEntries(body.split(";").filter((entry) => entry.includes(":")).map((entry) => {
    const colon = entry.indexOf(":");
    return [entry.slice(0, colon).trim(), entry.slice(colon + 1).trim()];
  }));
}

describe("styles/see-more.css comment hygiene", () => {
  it("keeps the clamp selector's prelude free of leaked comment text", () => {
    const raw = readFileSync(CSS_PATH, "utf8");
    const preludes = extractRulePreludes(stripWellFormedComments(raw));

    // Regression pin: if any comment above this rule loses its opening `/*` again, the prelude
    // here would be that comment's prose plus this selector fused together, not this exact string.
    expect(preludes).toContain(".see-more .see-more-text");
    for (const selector of [
      ".see-more",
      ".see-more .see-more-text.is-expanded",
      ".see-more .see-more-toggle",
      ".see-more .see-more-toggle:hover",
    ]) {
      expect(preludes).toContain(selector);
    }
  });

  it("keeps the clamp declarations attached to their selector", () => {
    const raw = readFileSync(CSS_PATH, "utf8");
    const stripped = stripWellFormedComments(raw);
    const ruleStart = stripped.indexOf(".see-more .see-more-text {");
    expect(ruleStart).toBeGreaterThan(-1);

    const blockEnd = stripped.indexOf("}", ruleStart);
    const block = stripped.slice(ruleStart, blockEnd);
    expect(block).toContain("display: -webkit-box");
    expect(block).toContain("-webkit-line-clamp: var(--see-more-lines, 2)");
    expect(block).toContain("overflow: hidden");
    expect(declarations(block)).toMatchObject({
      display: "-webkit-box",
      "-webkit-box-orient": "vertical",
      "-webkit-line-clamp": "var(--see-more-lines, 2)",
      overflow: "hidden",
      "white-space": "normal",
      "overflow-wrap": "anywhere",
    });
  });

  it("lifts the clamp and reveals overflow when the text is expanded", () => {
    const stripped = stripWellFormedComments(readFileSync(CSS_PATH, "utf8"));
    expect(extractRulePreludes(stripped)).toContain(".see-more .see-more-text.is-expanded");
    const ruleStart = stripped.indexOf(".see-more .see-more-text.is-expanded {");
    expect(ruleStart).toBeGreaterThan(-1);
    const block = stripped.slice(ruleStart, stripped.indexOf("}", ruleStart));
    expect(block).toContain("display: block;");
    expect(block).toContain("-webkit-line-clamp: unset;");
    expect(block).toContain("overflow: visible;");
  });

  it("keeps the toggle legible and overrides the global filled button style", () => {
    const stripped = stripWellFormedComments(readFileSync(CSS_PATH, "utf8"));
    expect(extractRulePreludes(stripped)).toContain(".see-more .see-more-toggle");
    const ruleStart = stripped.indexOf(".see-more .see-more-toggle {");
    expect(ruleStart).toBeGreaterThan(-1);
    const block = stripped.slice(ruleStart, stripped.indexOf("}", ruleStart));
    expect(declarations(block)).toMatchObject({ display: "inline-block", background: "none", color: "var(--jini-accent)", border: "none" });
  });
});
