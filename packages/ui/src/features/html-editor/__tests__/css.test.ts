import { describe, expect, it } from "vitest";

import { prettifyCss } from "../css.js";

/**
 * @file Pins `prettifyCss`'s exact output for the shapes GrapesJS's single-line `getCss()` produces,
 * plus the malformed-input edges the tokenizer tolerates (stray `)`/`}`, an unterminated string).
 */
describe("prettifyCss", () => {
  it("puts each declaration of a rule on its own indented line", () => {
    expect(prettifyCss(".a{color:red;background:blue;}")).toBe(".a {\n  color: red;\n  background: blue;\n}");
  });

  it("keeps an empty rule on one line", () => {
    expect(prettifyCss(".a{}")).toBe(".a {}");
  });

  it("keeps a whitespace-only rule on one line", () => {
    expect(prettifyCss(".a{  }")).toBe(".a {}");
  });

  it("indents rules nested inside an at-rule", () => {
    expect(prettifyCss("@media (max-width:600px){.a{color:red;}.b{margin:0;}}")).toBe(
      "@media (max-width:600px) {\n  .a {\n    color: red;\n  }\n  .b {\n    margin: 0;\n  }\n}",
    );
  });

  it("leaves structural characters inside a double-quoted string alone", () => {
    expect(prettifyCss('.a{content:"a;b{c}";}')).toBe('.a {\n  content: "a;b{c}";\n}');
  });

  it("keeps an escaped quote inside a single-quoted string", () => {
    expect(prettifyCss(".a{content:'x\\'y;';}")).toBe(".a {\n  content: 'x\\'y;';\n}");
  });

  it("leaves a semicolon inside a url() value alone", () => {
    expect(prettifyCss(".a{background:url(data:image/svg+xml;base64,AAA);}")).toBe(
      ".a {\n  background: url(data:image/svg+xml;base64,AAA);\n}",
    );
  });

  it("leaves braces inside parentheses alone", () => {
    expect(prettifyCss(".a{b:f({x});}")).toBe(".a {\n  b: f({x});\n}");
  });

  it("does not space a selector's own colon", () => {
    expect(prettifyCss(".a:hover{color:red}")).toBe(".a:hover {\n  color: red\n}");
  });

  it("separates top-level rules with a blank line", () => {
    expect(prettifyCss(".a{color:red}.b{color:blue}")).toBe(".a {\n  color: red\n}\n\n.b {\n  color: blue\n}");
  });

  it("collapses whitespace runs inside a value to one space", () => {
    expect(prettifyCss(".a{font-family:a,   b\n c;}")).toBe(".a {\n  font-family: a, b c;\n}");
  });

  it("spaces only the first colon of a declaration", () => {
    expect(prettifyCss(".a{a:b:c;}")).toBe(".a {\n  a: b:c;\n}");
  });

  it("drops spaces after the property colon", () => {
    expect(prettifyCss(".a{color:   red}")).toBe(".a {\n  color: red\n}");
  });

  it("keeps a stray closing paren without going negative", () => {
    expect(prettifyCss("a)f(;)")).toBe("a)f(;)");
  });

  it("keeps a stray closing brace without going negative", () => {
    expect(prettifyCss("}x")).toBe("}\n\nx");
  });

  it("breaks the line after a top-level semicolon followed by more text", () => {
    expect(prettifyCss("a;b")).toBe("a;\nb");
  });

  it("adds nothing after a trailing top-level semicolon", () => {
    expect(prettifyCss("a;")).toBe("a;");
  });

  it("trims surrounding whitespace and the space before an opening brace", () => {
    expect(prettifyCss("  .a  {  color :  red ;  }  ")).toBe(".a {\n  color : red ;\n}");
  });

  it("copies an unterminated string ending in a backslash as-is", () => {
    expect(prettifyCss('"unterminated\\')).toBe('"unterminated\\');
  });

  it("returns an empty string for empty input", () => {
    expect(prettifyCss("")).toBe("");
  });
});
