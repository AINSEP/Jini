import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { pageThemeReadContent, selectThemeReadContent } from "../read-content.node.js";

const truncationHint = "Narrow the search and reduce context.";
const invalidOffsetError = () => new Error("invalid byte offset");

test("byte paging recovers every byte and rolls back before a continuation byte", () => {
  const content = "a".repeat(3999) + "😀" + "body{color:red}".repeat(6000);
  let offset: number | undefined;
  let recovered = "";
  do {
    const result = pageThemeReadContent({ content, offset, invalidOffsetError });
    assert.ok(Buffer.byteLength(result.content) <= 4000);
    assert.equal(result.offset, offset ?? 0);
    assert.equal(result.totalBytes, Buffer.byteLength(content));
    assert.equal(result.truncated, result.nextOffset !== null);
    assert.ok(!result.content.includes("�"));
    recovered += result.content;
    if (result.nextOffset === null) break;
    assert.ok(result.nextOffset !== undefined && result.nextOffset > (offset ?? 0));
    if (offset === undefined) assert.equal(result.nextOffset, 3999);
    offset = result.nextOffset;
  } while (true);
  assert.equal(recovered, content);
});

test("a selected minified line is paged while retaining its range", () => {
  const selected = selectThemeReadContent({ content: "header\n" + "x".repeat(80000) + "\nfooter",
    selection: { mode: "window", startLine: 2, lineCount: 1 }, truncationHint });
  const first = pageThemeReadContent({ content: selected.content, offset: undefined, invalidOffsetError });
  assert.equal(first.content, "x".repeat(4000));
  assert.equal(first.nextOffset, 4000);
  assert.deepEqual(selected.returned, { startLine: 2, endLine: 2 });
  const next = pageThemeReadContent({ content: selected.content, offset: first.nextOffset ?? undefined, invalidOffsetError });
  assert.equal(next.content, "x".repeat(4000));
  assert.equal(next.offset, 4000);
});

test("mid-character and past-end cursors throw the supplied error", () => {
  const failure = new Error("fixture cursor failure");
  const errorFactory = vi.fn(() => failure);
  for (const offset of [1, 7000]) {
    assert.throws(() => pageThemeReadContent({ content: "é".repeat(3000), offset, invalidOffsetError: errorFactory }),
      error => error === failure);
  }
  assert.deepEqual(errorFactory.mock.calls, [[{}], [{}]]);
});

test("windows preserve CRLF, clamp at EOF, and invent no line after a final newline", () => {
  assert.deepEqual(selectThemeReadContent({ content: "é first\r\nsecond\r\nthird\r\nlast",
    selection: { mode: "window", startLine: 2, lineCount: 2 }, truncationHint }), {
    content: "second\r\nthird\r\n", totalLines: 4, returned: { startLine: 2, endLine: 3 },
  });
  assert.deepEqual(selectThemeReadContent({ content: "one\ntwo\nthree\n",
    selection: { mode: "window", startLine: 3, lineCount: 20 }, truncationHint }), {
    content: "three\n", totalLines: 3, returned: { startLine: 3, endLine: 3 },
  });
});

test("find is literal and case sensitive and merges overlapping context", () => {
  assert.deepEqual(selectThemeReadContent({ content: "zero\npre\n[a.b]\nbetween\n[a.b] again\npost\nskip\n[A.B]\n",
    selection: { mode: "find", find: "[a.b]", context: 1, startLine: 1 }, truncationHint }), {
    content: "pre\n[a.b]\nbetween\n[a.b] again\npost\n", totalLines: 8,
    returned: { matches: 2, truncated: false },
  });
});

test("find counts matching lines once and zero context includes only matching lines", () => {
  assert.deepEqual(selectThemeReadContent({ content: "needle needle\nother\nneedle",
    selection: { mode: "find", find: "needle", context: 0, startLine: 1 }, truncationHint }), {
    content: "needle needle\nneedle", totalLines: 3, returned: { matches: 2, truncated: false },
  });
});

test("find distinguishes exactly 50 matches from overflow and uses the supplied hint only when truncated", () => {
  for (const count of [50, 51]) {
    assert.deepEqual(selectThemeReadContent({ content: "hit\n".repeat(count),
      selection: { mode: "find", find: "hit", context: 0, startLine: 1 }, truncationHint }), {
      content: "hit\n".repeat(50), totalLines: count,
      returned: { matches: 50, truncated: count > 50, ...(count > 50 ? { hint: truncationHint } : {}) },
    });
  }
});

test("a capped minified match remains visible away from the start", () => {
  const content = "x".repeat(980_000) + "needle" + "y".repeat(10_000);
  const result = selectThemeReadContent({ content,
    selection: { mode: "find", find: "needle", context: 3, startLine: 1 }, truncationHint });
  assert.equal(result.content.length, 2_000);
  assert.ok(result.content.includes("needle"));
  assert.equal(result.totalLines, 1);
  assert.deepEqual(result.returned, { matches: 1, truncated: true, hint: truncationHint });
});

test("find distinguishes an exact character cap from omitted text", () => {
  for (const length of [2_000, 2_001]) {
    const result = selectThemeReadContent({ content: "needle" + "x".repeat(length - 6),
      selection: { mode: "find", find: "needle", context: 3, startLine: 1 }, truncationHint });
    assert.equal(result.content.length, 2_000);
    assert.deepEqual(result.returned, { matches: 1, truncated: length > 2_000,
      ...(length > 2_000 ? { hint: truncationHint } : {}) });
  }
});

test("find caps the aggregate content of disjoint windows at 4000 characters", () => {
  const content = ("x".repeat(3_000) + "needle" + "y".repeat(3_000) + "\nspacer\n").repeat(3);
  const result = selectThemeReadContent({ content,
    selection: { mode: "find", find: "needle", context: 0, startLine: 1 }, truncationHint });
  assert.equal(result.content.length, 4_000);
  assert.equal(result.content, ("x".repeat(1_000) + "needle" + "y".repeat(994)).repeat(2));
  assert.deepEqual(result.returned, { matches: 3, truncated: true, hint: truncationHint });
});

test("empty files and windows beyond EOF return no invented text", () => {
  assert.deepEqual(selectThemeReadContent({ content: "",
    selection: { mode: "window", startLine: 1, lineCount: 1 }, truncationHint }), {
    content: "", totalLines: 0, returned: { startLine: 1, endLine: 0 },
  });
  assert.deepEqual(selectThemeReadContent({ content: "",
    selection: { mode: "find", find: "anything", context: 3, startLine: 1 }, truncationHint }), {
    content: "", totalLines: 0, returned: { matches: 0, truncated: false },
  });
  assert.deepEqual(selectThemeReadContent({ content: "one\ntwo",
    selection: { mode: "window", startLine: 9, lineCount: 2000 }, truncationHint }), {
    content: "", totalLines: 2, returned: { startLine: 9, endLine: 2 },
  });
});

test("find confines matches and context to the selected range", () => {
  for (const window of [{ startLine: 1 }, { lineCount: 1 }]) {
    const result = selectThemeReadContent({ content: "one\ntwo\none\n",
      selection: { mode: "find", find: "one", context: 3, ...window, startLine: window.startLine ?? 1 }, truncationHint });
    assert.deepEqual(result.returned, { matches: "lineCount" in window ? 1 : 2, truncated: false });
    assert.equal(result.content, "lineCount" in window ? "one\n" : "one\ntwo\none\n");
  }
  assert.deepEqual(selectThemeReadContent({ content: "one\ntwo\none\n",
    selection: { mode: "find", find: "one", context: 3, startLine: 2, lineCount: 1 }, truncationHint }), {
    content: "", totalLines: 3, returned: { matches: 0, truncated: false },
  });
});
