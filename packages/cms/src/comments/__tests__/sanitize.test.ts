import assert from "node:assert/strict";
import { test } from "vitest";

import { countLinks, sanitizeCommentBody } from "../sanitize.js";

// F1.2/F4.3: removing any normalization pass must change these literal outputs.
test("sanitizes tags, excess horizontal whitespace and blank lines while preserving paragraphs", () => {
  assert.equal(sanitizeCommentBody({ raw: " \t<b>Hello</b>  \t world\n\n\n\nsecond\nline <i>end</i>  " }, {}), "Hello world\n\nsecond\nline end");
  assert.equal(sanitizeCommentBody({ raw: "<br> \t <hr>" }, {}), "");
  assert.equal(sanitizeCommentBody({ raw: "one two\n\nthree\nfour" }, {}), "one two\n\nthree\nfour");
});

test("counts HTTP and HTTPS links case-insensitively, excluding bare domains and other schemes", () => {
  assert.equal(countLinks({ text: "HTTPS://a.example/x http://b.example HTTPS://c.example?q=1 ftp://d.example www.e.example" }, {}), 3);
  assert.equal(countLinks({ text: "no links or mailto:user@example.com" }, {}), 0);
  assert.equal(countLinks({ text: "https://only.example" }, {}), 1);
});
