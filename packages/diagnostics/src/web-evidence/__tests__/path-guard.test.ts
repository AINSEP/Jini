import assert from "node:assert/strict";
import { test } from "vitest";

import { MAX_PATH_LENGTH, resolveSameOriginPath as guard, resolveWithinOrigin, SameOriginPathError, type PathnameVerdict } from "../path-guard.js";

/**
 * @file The path guard's own contract, with the host policy replaced by a fake: the guard owns the
 * raw-string shape rules, ONE percent-decode pass, the structural same-origin assertion and the
 * mapping of each policy verdict to an error; the policy owns which surfaces are reserved.
 */

const BASE = "http://127.0.0.1:53142";
const RESERVED = new Set(["admin", "api"]);

/** A host policy with the same verdict shapes a real one returns: decode, then compare whole segments. */
function fakePolicy({ url }: { url: URL }): PathnameVerdict {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return { kind: "malformed-encoding" };
  }
  if (decoded.includes("\\") || [...decoded].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    return { kind: "disallowed-character" };
  }
  const first = (decoded.split("/")[1] ?? "").toLowerCase();
  return RESERVED.has(first) ? { kind: "refused", reason: reservedMessage(first) } : { kind: "ok" };
}

function resolveSameOriginPath({ raw, base }: { raw: unknown; base: string }): string {
  return guard({ raw, base, checkPathname: fakePolicy });
}

test("resolveSameOriginPath: accepts ordinary root-relative site paths", () => {
  assert.equal(resolveSameOriginPath({ raw: "/", base: BASE }), "/");
  assert.equal(resolveSameOriginPath({ raw: "/about", base: BASE }), "/about");
  assert.equal(resolveSameOriginPath({ raw: "/blog/hello?page=2", base: BASE }), "/blog/hello?page=2");
  assert.equal(resolveSameOriginPath({ raw: "/robots.txt", base: BASE }), "/robots.txt");
});

test("resolveSameOriginPath: refuses an absolute URL, whatever the scheme", () => {
  for (const candidate of [
    "http://evil.example/x",
    "https://evil.example/x",
    "HTTP://evil.example/x",
    "file:///etc/passwd",
    "gopher://127.0.0.1:11211/",
    "http://169.254.169.254/latest/meta-data/",
  ]) {
    assert.throws(() => resolveSameOriginPath({ raw: candidate, base: BASE }), SameOriginPathError, `should refuse '${candidate}'`);
  }
});

test("resolveSameOriginPath: refuses a protocol-relative path — the classic same-origin bypass", () => {
  assert.throws(() => resolveSameOriginPath({ raw: "//evil.example/x", base: BASE }), SameOriginPathError);
  assert.throws(() => resolveSameOriginPath({ raw: "//169.254.169.254/", base: BASE }), SameOriginPathError);
});

test("resolveSameOriginPath: refuses a backslash, which URL parsers treat as a slash", () => {
  assert.throws(() => resolveSameOriginPath({ raw: "/\\evil.example/x", base: BASE }), SameOriginPathError);
  assert.throws(() => resolveSameOriginPath({ raw: "\\\\evil.example/x", base: BASE }), SameOriginPathError);
});

test("resolveSameOriginPath: refuses control characters, including CR/LF request splitting", () => {
  const cr = String.fromCharCode(13);
  const lf = String.fromCharCode(10);
  const nul = String.fromCharCode(0);
  assert.throws(() => resolveSameOriginPath({ raw: `/ok${cr}${lf}X-Injected: 1`, base: BASE }), SameOriginPathError);
  assert.throws(() => resolveSameOriginPath({ raw: `/ok${nul}`, base: BASE }), SameOriginPathError);
  assert.throws(() => resolveSameOriginPath({ raw: `/ok${String.fromCharCode(127)}`, base: BASE }), SameOriginPathError);
});

test("resolveSameOriginPath: refuses traversal, raw and percent-encoded", () => {
  assert.throws(() => resolveSameOriginPath({ raw: "/a/../../etc/passwd", base: BASE }), SameOriginPathError);
  assert.throws(() => resolveSameOriginPath({ raw: "/a/%2e%2e/%2e%2e/etc/passwd", base: BASE }), SameOriginPathError);
  assert.throws(() => resolveSameOriginPath({ raw: "/a/%2E%2E/b", base: BASE }), SameOriginPathError);
});

test("resolveSameOriginPath: refuses a malformed percent-encoding rather than silently repairing it", () => {
  assert.throws(() => resolveSameOriginPath({ raw: "/a/%zz", base: BASE }), SameOriginPathError);
});

test("resolveSameOriginPath: refuses a surface the injected policy reserves", () => {
  assert.throws(() => resolveSameOriginPath({ raw: "/api/admin/v1/workspaces/x/settings", base: BASE }), SameOriginPathError);
  assert.throws(() => resolveSameOriginPath({ raw: "/API/admin/v1/x", base: BASE }), SameOriginPathError);
  assert.throws(() => resolveSameOriginPath({ raw: "/%61pi/admin/v1/x", base: BASE }), SameOriginPathError);
});

test("resolveSameOriginPath: refuses empty, non-string and oversized paths", () => {
  assert.throws(() => resolveSameOriginPath({ raw: "", base: BASE }), SameOriginPathError);
  assert.throws(() => resolveSameOriginPath({ raw: undefined, base: BASE }), SameOriginPathError);
  assert.throws(() => resolveSameOriginPath({ raw: 42, base: BASE }), SameOriginPathError);
  assert.throws(() => resolveSameOriginPath({ raw: `/${"a".repeat(MAX_PATH_LENGTH)}`, base: BASE }), SameOriginPathError);
});

test("resolveSameOriginPath: a rejection names the rule so a model can fix the input in one turn", () => {
  assert.throws(
    () => resolveSameOriginPath({ raw: "https://evil.example/x", base: BASE }),
    (err: unknown) => err instanceof SameOriginPathError && err.message.includes("must start with '/'"),
  );
  assert.throws(
    () => resolveSameOriginPath({ raw: "//evil.example/x", base: BASE }),
    (err: unknown) => err instanceof SameOriginPathError && err.message.includes("different host"),
  );
});

/** The refusal sentence the fake policy hands back for a reserved surface. */
function reservedMessage(surface: string): string {
  return `reserved surface '/${surface}'`;
}

function refusalMessage(raw: unknown): string {
  try {
    resolveSameOriginPath({ raw, base: BASE });
  } catch (err) {
    assert.ok(err instanceof SameOriginPathError, `expected a SameOriginPathError for ${String(raw)}`);
    return err.message;
  }
  throw new assert.AssertionError({ message: `expected '${String(raw)}' to be refused` });
}

test("resolveSameOriginPath: a double-encoded traversal is ACCEPTED as a literal filename (one decode pass, by design)", () => {
  // Pins published-page.ts's own comment: "One decode pass is the right depth: a double-encoded
  // `%252e%252e` decodes to the literal text `%2e%2e`, which a static-file handler treats as a
  // filename, not as traversal."
  assert.equal(resolveSameOriginPath({ raw: "/a/%252e%252e/b", base: BASE }), "/a/%252e%252e/b");
  assert.equal(resolveSameOriginPath({ raw: "/%252E%252E", base: BASE }), "/%252E%252E");
});

test("resolveSameOriginPath: raw and singly-encoded traversal name the '..' rule, quoting the caller's string", () => {
  for (const raw of ["/a/../b", "/a/%2e%2e/b", "/a/%2E%2E/b", "/a/%2e./b", "/a/.%2E/b", "/..", "/a/%2e%2e"]) {
    assert.equal(refusalMessage(raw), `path must not contain a '..' segment (encoded or not): '${raw}'.`);
  }
});

test("resolveSameOriginPath: a segment that merely contains dots is an ordinary filename", () => {
  assert.equal(resolveSameOriginPath({ raw: "/a/..b/c...", base: BASE }), "/a/..b/c...");
  assert.equal(resolveSameOriginPath({ raw: "/a/%2e%2e%2e", base: BASE }), "/a/%2e%2e%2e");
});

test("resolveSameOriginPath: a malformed percent-encoding is refused with its own message", () => {
  for (const raw of ["/a/%zz", "/%", "/a%2/b", "/a/%E0%A4%A"]) {
    assert.equal(refusalMessage(raw), `path contains a malformed percent-encoding: '${raw}'.`);
  }
});

test("resolveSameOriginPath: only the path is validated, so the query is kept verbatim", () => {
  assert.equal(resolveSameOriginPath({ raw: "/blog?page=2&q=a%20b", base: BASE }), "/blog?page=2&q=a%20b");
  assert.equal(resolveSameOriginPath({ raw: "/a?back=/../x", base: BASE }), "/a?back=/../x");
  assert.equal(resolveSameOriginPath({ raw: "/a?q=%zz", base: BASE }), "/a?q=%zz");
  assert.equal(resolveSameOriginPath({ raw: "/?", base: BASE }), "/");
});

test("resolveSameOriginPath: the fragment is dropped from the canonical path, but is still scanned for '..'", () => {
  assert.equal(resolveSameOriginPath({ raw: "/a#frag", base: BASE }), "/a");
  assert.equal(resolveSameOriginPath({ raw: "/a?x=1#frag", base: BASE }), "/a?x=1");
  // The traversal scan runs on the raw string up to the first '?', which still contains the fragment.
  assert.equal(refusalMessage("/a#/../b"), "path must not contain a '..' segment (encoded or not): '/a#/../b'.");
});

test("resolveSameOriginPath: wording for a relative, protocol-relative, backslash and control-character refusal", () => {
  assert.equal(refusalMessage("blog/hello"), "path must start with '/' — this tool fetches a route on THIS site and never accepts a full URL or a remote host. Got 'blog/hello'.");
  assert.equal(refusalMessage("//evil.example/x"), "path must not start with '//' — a protocol-relative path resolves to a different host, which this tool never fetches.");
  assert.equal(refusalMessage("/a\\b"), "path must not contain a backslash — URL parsers treat '\\' as '/'.");
  assert.equal(refusalMessage("/a\nb"), "path must not contain control characters (including CR/LF).");
  assert.equal(refusalMessage(""), "path must be a non-empty string, e.g. '/' or '/blog/hello'.");
  assert.equal(refusalMessage(null), "path must be a non-empty string, e.g. '/' or '/blog/hello'.");
});

test("resolveSameOriginPath: an absolute URL to another origin is refused by the leading-slash rule, never fetched", () => {
  for (const raw of ["http://127.0.0.1:53142/x", "http://evil.example:53142/x", "https://127.0.0.1/x"]) {
    assert.match(refusalMessage(raw), /^path must start with '\/'/);
  }
});

test("resolveSameOriginPath: length is bounded by MAX_PATH_LENGTH (2047 and 2048 pass, 2049 is refused)", () => {
  assert.equal(MAX_PATH_LENGTH, 2_048);
  for (const length of [MAX_PATH_LENGTH - 1, MAX_PATH_LENGTH]) {
    const raw = `/${"a".repeat(length - 1)}`;
    assert.equal(raw.length, length);
    assert.equal(resolveSameOriginPath({ raw, base: BASE }), raw);
  }
  const tooLong = `/${"a".repeat(MAX_PATH_LENGTH)}`;
  assert.equal(tooLong.length, MAX_PATH_LENGTH + 1);
  assert.equal(refusalMessage(tooLong), `path must be at most ${MAX_PATH_LENGTH} characters, got ${MAX_PATH_LENGTH + 1}.`);
});

test("resolveSameOriginPath: the injected policy refuses /admin and /api in every spelling and its sentence reaches the caller verbatim", () => {
  const cases: Array<[string, string]> = [
    ["/admin", "admin"],
    ["/Admin", "admin"],
    ["/ADMIN/settings", "admin"],
    ["/admin/", "admin"],
    ["/%61dmin", "admin"],
    ["/%41dmin/x", "admin"],
    ["/api", "api"],
    ["/api/x", "api"],
    ["/API/x", "api"],
    ["/%61pi", "api"],
    ["/%61pi/x", "api"],
    ["/api/admin/v1/secret?x=1", "api"],
  ];
  for (const [raw, surface] of cases) {
    assert.equal(refusalMessage(raw), reservedMessage(surface), `expected '${raw}' to be refused as '/${surface}'`);
  }
});

test("resolveSameOriginPath: the injected policy decides per segment, so look-alike content stays fetchable", () => {
  for (const raw of ["/administer-survey", "/apiary", "/admins", "/api-docs", "/blog/admin"]) {
    assert.equal(resolveSameOriginPath({ raw, base: BASE }), raw);
  }
});

test("resolveSameOriginPath: a decoded backslash or control character is refused through the host check", () => {
  // These pass every raw-string rule (no literal backslash or control character) and only show up
  // once the pathname is decoded, which is the host policy's job.
  for (const raw of ["/a%5Cb", "/a%5cb", "/a%00b", "/a%0D%0AX-Injected:%201", "/a%1Fb", "/a%7Fb"]) {
    assert.equal(refusalMessage(raw), "path decodes to a backslash or control character, which is refused.", `expected '${raw}' to be refused`);
  }
});

test("the policy runs on the RESOLVED url, after the shape rules, and a refusal sentence is passed through verbatim", () => {
  const seen: string[] = [];
  const recording = ({ url }: { url: URL }): PathnameVerdict => {
    seen.push(url.pathname + url.search);
    return { kind: "refused", reason: "HOST SENTENCE" };
  };
  assert.throws(() => guard({ raw: "/a?x=1", base: BASE, checkPathname: recording }), (err: unknown) => err instanceof SameOriginPathError && err.message === "HOST SENTENCE");
  assert.deepEqual(seen, ["/a?x=1"]);
  // A path that fails a shape rule never reaches the policy.
  assert.throws(() => guard({ raw: "//evil.example", base: BASE, checkPathname: recording }), SameOriginPathError);
  assert.deepEqual(seen, ["/a?x=1"]);
});

test("a policy that answers ok lets every shape-valid path through unchanged", () => {
  const allowAll = (): PathnameVerdict => ({ kind: "ok" });
  assert.equal(guard({ raw: "/admin", base: BASE, checkPathname: allowAll }), "/admin");
  assert.equal(guard({ raw: "/blog/hello?page=2", base: BASE, checkPathname: allowAll }), "/blog/hello?page=2");
});

test("the error class carries its own name, for a tool layer that tells it from a transport fault", () => {
  const error = new SameOriginPathError({ message: "m" });
  assert.equal(error.name, "SameOriginPathError");
  assert.ok(error instanceof Error);
});

test("each policy verdict maps to its own refusal wording", () => {
  const refusal = (verdict: PathnameVerdict): string => {
    try {
      guard({ raw: "/a", base: BASE, checkPathname: () => verdict });
    } catch (err) {
      assert.ok(err instanceof SameOriginPathError);
      return err.message;
    }
    throw new assert.AssertionError({ message: "expected a refusal" });
  };
  assert.equal(refusal({ kind: "malformed-encoding" }), "path contains a malformed percent-encoding: '/a'.");
  assert.equal(refusal({ kind: "disallowed-character" }), "path decodes to a backslash or control character, which is refused.");
  assert.equal(refusal({ kind: "refused", reason: "nope" }), "nope");
});

test("a verdict the guard does not know is a programming error, never an implicit allow", () => {
  const unknownVerdict = { kind: "future-verdict" } as unknown as PathnameVerdict;
  assert.throws(() => guard({ raw: "/a", base: BASE, checkPathname: () => unknownVerdict }), TypeError);
});

test("resolveWithinOrigin: an unparseable reference and an off-origin result are each refused", () => {
  assert.throws(() => resolveWithinOrigin({ raw: "http://[", base: BASE }), (err: unknown) => err instanceof SameOriginPathError && err.message === "path is not a valid URL path: 'http://['.");
  assert.throws(
    () => resolveWithinOrigin({ raw: "http://evil.example/x", base: BASE }),
    (err: unknown) => err instanceof SameOriginPathError && err.message === "path resolved off-origin (to 'http://evil.example') — this tool only fetches routes on this site.",
  );
  assert.equal(resolveWithinOrigin({ raw: "/x?y=1", base: BASE }).pathname, "/x");
});
