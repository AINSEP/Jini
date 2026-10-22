import { describe, expect, it } from "vitest";
import { redactSecretShapes, type RedactionRule } from "../secrets-only.js";

/*
 * None of these strings are real credentials: every secret-shaped value is assembled at runtime
 * (`.repeat`) so no real-length literal sits in this file.
 */
const value = "abc123".repeat(4);
const half = "Zy9".repeat(4);
const strict = (text: string) => redactSecretShapes({ text, policy: {} });
const code = (text: string, additionalRules: readonly RedactionRule[] = []) =>
  redactSecretShapes({ text, policy: { codeAware: true, additionalRules } });

describe("redactSecretShapes — header, vendor and query rules", () => {
  it("replaces a whole Cookie header value list, including every following attribute", () => {
    expect(strict(`Cookie: session=${value}; theme=dark`)).toEqual({ text: "Cookie: [REDACTED:auth_header]", redactions: 1 });
    expect(strict(`set-cookie=${value}`)).toEqual({ text: "set-cookie=[REDACTED:auth_header]", redactions: 1 });
  });

  it("replaces a Google 'AQ.' API key", () => {
    expect(strict(`key AQ.${half}${half}`)).toEqual({ text: "key [REDACTED:google_api_key]", redactions: 1 });
  });

  it("replaces credential-named query parameters but keeps the rest of the query", () => {
    expect(strict(`GET /cb?access_token=${value}&x=1`)).toEqual({ text: "GET /cb?access_token=[REDACTED:labeled_secret]&x=1", redactions: 1 });
    expect(strict(`https://x.example/cb?sig=${value}`).text).toBe("https://x.example/cb?sig=[REDACTED:labeled_secret]");
  });
});

describe("redactSecretShapes — vendorOnly policy", () => {
  it("applies caller additionalRules alongside the vendor rules", () => {
    const additionalRules: readonly RedactionRule[] = [{ kind: "custom", pattern: /ab_x{20,}/g, replacement: () => "[REDACTED:custom]" }];
    const input = `id ab_${"x".repeat(20)}`;
    expect(redactSecretShapes({ text: input, policy: { vendorOnly: true, additionalRules } })).toEqual({ text: "id [REDACTED:custom]", redactions: 1 });
    expect(redactSecretShapes({ text: input, policy: { vendorOnly: true } })).toEqual({ text: input, redactions: 0 });
  });
});

describe("redactSecretShapes — code-aware static escape decoding", () => {
  // Classification runs on the decoded literal, so an escape cannot be used to split a key shape.
  it("drops an out-of-range \\u{...} escape when classifying, so the joined halves are seen as one key", () => {
    expect(code(`x("AQ.${half}\\u{110000}${half}");`)).toEqual({ text: 'x("[REDACTED:google_api_key]");', redactions: 1 });
  });

  it("decodes an in-range \\u{...} escape to its code point, which here breaks the key shape", () => {
    const input = `x("AQ.${half}\\u{10FFFF}${half}");`;
    expect(code(input)).toEqual({ text: input, redactions: 0 });
  });

  it("treats a backslash-newline line continuation as nothing", () => {
    expect(code(`x("AQ.${half}\\\n${half}");`)).toEqual({ text: 'x("[REDACTED:google_api_key]");', redactions: 1 });
  });

  it("decodes an unknown single-character escape to the character itself, but a known one to its control character", () => {
    expect(code(`x("AQ.${half}\\q${half}");`)).toEqual({ text: 'x("[REDACTED:google_api_key]");', redactions: 1 });
    const newlineSplit = `x("AQ.${half}\\n${half}");`;
    expect(code(newlineSplit)).toEqual({ text: newlineSplit, redactions: 0 });
  });

  it("falls back to a generic marker when a caller rule redacts an escaped literal without emitting one", () => {
    const additionalRules: readonly RedactionRule[] = [{ kind: "custom", pattern: /ab_x{20,}/g, replacement: () => "***" }];
    expect(code(`const k = "\\x61b_${"x".repeat(20)}";`, additionalRules)).toEqual({ text: 'const k = "[REDACTED:escaped_secret]";', redactions: 1 });
  });
});
