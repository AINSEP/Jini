// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { prettifyCss } from '../css.js';

describe('CSS serialization formatting pins', () => {
  it.each([
    ['', ''],
    ['a{} b { }', 'a {}\n\nb {}'],
    ['a:hover{color:  red; margin:0}', 'a:hover {\n  color: red;\n  margin: 0\n}'],
    ['@media x{a{color:red;}b{color:blue;}}', '@media x {\n  a {\n    color: red;\n  }\n  b {\n    color: blue;\n  }\n}'],
    ['a{content:"a;{b}:c";src:url(data:x;y);}', 'a {\n  content: "a;{b}:c";\n  src: url(data:x;y);\n}'],
    ["a{content:'it\\'s';x:fn((a;b));}", "a {\n  content: 'it\\'s';\n  x: fn((a;b));\n}"],
    ['a{value:x:y; empty:; }', 'a {\n  value: x:y;\n  empty: ;\n}'],
    ['a{ x:\t y; }', 'a {\n  x:  y;\n}'],
    ['a{content:"tail\\', 'a {\n  content: "tail\\'],
    ['a{content:"tail', 'a {\n  content: "tail'],
    [') ; x', ') ;\nx'],
  ])('preserves formatting of %j', (css, expected) => {
    expect(prettifyCss(css)).toBe(expected);
  });
});
