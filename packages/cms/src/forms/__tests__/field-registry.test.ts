import assert from "node:assert/strict";
import { test } from "vitest";
import { FIELD_TYPE_REGISTRY, isBrowserSafeFieldPattern, isSafeFieldPattern, MAX_FORM_FILE_BYTES, resolveFormField, type FieldResolution } from "../field-registry.js";
import type { FieldDescriptor, FormFileInput, FormFileStoragePort } from "../types.js";

const field = (overrides: Partial<FieldDescriptor> = {}): FieldDescriptor => ({ id: "answer", label: "Answer", type: "text", required: false, ...overrides });
const resolve = (overrides: Partial<FieldDescriptor>, value: unknown): FieldResolution => resolveFormField({ field: field(overrides), value });
const accepted = (value: unknown): FieldResolution => JSON.parse(JSON.stringify({ kind: "accepted", value }));
const rejected = (reason: string): FieldResolution => ({ kind: "rejected", reason });
const absent: FieldResolution = { kind: "absent" };
const choices = [{ value: "a", label: "A" }, { value: "b", label: "B" }];

const PNG = new Uint8Array([137, 80, 78, 71]);
const files: Pick<FormFileStoragePort, "detectContentType"> = { detectContentType: ({ bytes }) => (bytes[0] === 137 ? "image/png" : "text/html") };
const upload = (overrides: Partial<FormFileInput> = {}): FormFileInput => ({ filename: "photo.png", contentType: "image/png", bytes: PNG, ...overrides });
const resolveFile = (overrides: Partial<FieldDescriptor>, value: unknown): FieldResolution => resolveFormField({ field: field({ type: "file", ...overrides }), value }, { files });

test("resolveFormField: missing answers are required or absent", () => {
  assert.deepEqual(resolve({ required: true }, undefined), rejected("required"));
  assert.deepEqual(resolve({ required: true }, null), rejected("required"));
  assert.deepEqual(resolve({}, undefined), absent);
});

test("resolveFormField: an unregistered type, including an inherited property name, is refused", () => {
  assert.deepEqual(resolve({ type: "password" as FieldDescriptor["type"] }, "x"), rejected("invalid_type"));
  assert.deepEqual(resolve({ type: "toString" as FieldDescriptor["type"] }, "x"), rejected("invalid_type"));
});

test("text: non-strings and blank required answers are refused", () => {
  assert.deepEqual(resolve({}, 5), rejected("must be a string"));
  assert.deepEqual(resolve({ required: true }, "  "), rejected("required"));
  assert.deepEqual(resolve({}, ""), accepted(""));
});

test("text: length is capped at maxLength, defaulting to 5000", () => {
  assert.deepEqual(resolve({}, "x".repeat(5000)), accepted("x".repeat(5000)));
  assert.deepEqual(resolve({}, "x".repeat(5001)), rejected("too_long"));
  assert.deepEqual(resolve({ maxLength: null }, "x".repeat(5001)), rejected("too_long"));
  assert.deepEqual(resolve({ maxLength: 3 }, "abcd"), rejected("too_long"));
});

test("text: minLength (explicit or attribute) applies only to non-empty answers", () => {
  assert.deepEqual(resolve({ minLength: 3 }, "ab"), rejected("too_short"));
  assert.deepEqual(resolve({ minLength: 3 }, "abc"), accepted("abc"));
  assert.deepEqual(resolve({ attributes: { minlength: "3" } }, "ab"), rejected("too_short"));
  assert.deepEqual(resolve({ minLength: 3 }, ""), accepted(""));
});

test("text: patterns (explicit or attribute) must fully match non-empty answers", () => {
  assert.deepEqual(resolve({ pattern: "[a-z]+" }, "abc"), accepted("abc"));
  assert.deepEqual(resolve({ pattern: "[a-z]+" }, "abc1"), rejected("pattern_mismatch"));
  assert.deepEqual(resolve({ attributes: { pattern: "[0-9]+" } }, "x"), rejected("pattern_mismatch"));
  assert.deepEqual(resolve({ pattern: "[a-z]+" }, ""), accepted(""));
});

test("text: an unsafe stored pattern refuses every non-empty answer", () => {
  assert.deepEqual(resolve({ pattern: "(a)" }, "a"), rejected("pattern_mismatch"));
});

test("email: text rules first, then the email format", () => {
  assert.deepEqual(resolve({ type: "email" }, "ada@example.com"), accepted("ada@example.com"));
  assert.deepEqual(resolve({ type: "email" }, ""), accepted(""));
  assert.deepEqual(resolve({ type: "email" }, 1), rejected("must be a string"));
  assert.deepEqual(resolve({ type: "email" }, "ada@"), rejected("invalid_email"));
});

test("phone: bounded international spelling with at least one digit", () => {
  assert.deepEqual(resolve({ type: "phone" }, "+1 (555) 123-4567"), accepted("+1 (555) 123-4567"));
  assert.deepEqual(resolve({ type: "phone" }, ""), accepted(""));
  assert.deepEqual(resolve({ type: "phone" }, 1), rejected("must be a string"));
  assert.deepEqual(resolve({ type: "phone" }, "call me"), rejected("invalid_phone"));
  assert.deepEqual(resolve({ type: "phone" }, "(-)"), rejected("invalid_phone"));
  assert.deepEqual(resolve({ type: "phone" }, "1".repeat(51)), rejected("invalid_phone"));
});

test("url: handles, bare domains and http(s) addresses are kept as typed", () => {
  for (const value of ["@ada", "example.com", "www.example.co.uk/a?b#c", "example.com:8080", "http://example.com", "HTTPS://user@Example.com/x"]) {
    assert.deepEqual(resolve({ type: "url" }, value), accepted(value), value);
  }
  assert.deepEqual(resolve({ type: "url" }, ""), accepted(""));
  assert.deepEqual(resolve({ type: "url" }, 1), rejected("must be a string"));
});

test("url: whitespace, control characters, backslashes and active schemes are refused", () => {
  for (const value of ["exa mple.com", "example.com\\x", "a\u0001.com", "javascript:alert(1)", "ftp://example.com", "mailto:a@b.co"]) {
    assert.deepEqual(resolve({ type: "url" }, value), rejected("invalid_url"), value);
  }
});

test("url: the typed host must contain a dot and be a domain name", () => {
  for (const value of ["localhost", "http://localhost", "https://user@localhost:80", "https://a.b@localhost", "https://a.b@2130706433", "2130706433", "example.com:99999", "-bad-.com", "http://exa_mple.com"]) {
    assert.deepEqual(resolve({ type: "url" }, value), rejected("invalid_url"), value);
  }
});

test("number: blank answers are required or absent", () => {
  assert.deepEqual(resolve({ type: "number", required: true }, ""), rejected("required"));
  assert.deepEqual(resolve({ type: "number" }, ""), absent);
});

test("number: strict native spellings and finite numbers are stored as numbers", () => {
  assert.deepEqual(resolve({ type: "number" }, "4"), accepted(4));
  assert.deepEqual(resolve({ type: "number" }, 4), accepted(4));
  assert.deepEqual(resolve({ type: "number", step: 0.5 }, "-.5e0"), accepted(-0.5));
});

test("number: non-numeric, oversize, non-finite and wrongly typed answers are refused", () => {
  for (const value of ["abc", "1".repeat(101), "1e999", Number.POSITIVE_INFINITY, true, " 4"]) {
    assert.deepEqual(resolve({ type: "number" }, value), rejected("invalid_number"), String(value));
  }
});

test("number: explicit and attribute bounds are enforced", () => {
  assert.deepEqual(resolve({ type: "number", min: 5 }, "4"), rejected("below_min"));
  assert.deepEqual(resolve({ type: "number", max: "5" }, "6"), rejected("above_max"));
  assert.deepEqual(resolve({ type: "number", attributes: { min: "5" } }, "4"), rejected("below_min"));
  assert.deepEqual(resolve({ type: "number", attributes: { max: "5" } }, "6"), rejected("above_max"));
  assert.deepEqual(resolve({ type: "number" }, "-1000000"), accepted(-1000000));
});

test("range: the native 0..100 bounds apply when none are configured", () => {
  assert.deepEqual(resolve({ type: "range" }, "-1"), rejected("below_min"));
  assert.deepEqual(resolve({ type: "range" }, "101"), rejected("above_max"));
  assert.deepEqual(resolve({ type: "range" }, "100"), accepted(100));
});

test("number: answers must sit on the step from min (explicit, attribute or default 1)", () => {
  assert.deepEqual(resolve({ type: "number" }, "1.5"), rejected("step_mismatch"));
  assert.deepEqual(resolve({ type: "number", min: 1, step: 2 }, "3"), accepted(3));
  assert.deepEqual(resolve({ type: "number", min: 1, step: 2 }, "4"), rejected("step_mismatch"));
  assert.deepEqual(resolve({ type: "number", attributes: { step: "0.1" } }, "0.3"), accepted(0.3));
  assert.deepEqual(resolve({ type: "number", step: 0 }, "1"), rejected("step_mismatch"));
});

test("temporal: non-strings and oversize answers are refused as invalid_datetime", () => {
  assert.deepEqual(resolve({ type: "date" }, 5), rejected("invalid_datetime"));
  assert.deepEqual(resolve({ type: "time" }, "1".repeat(31)), rejected("invalid_datetime"));
});

test("temporal: blank answers are required or absent", () => {
  assert.deepEqual(resolve({ type: "date", required: true }, ""), rejected("required"));
  assert.deepEqual(resolve({ type: "datetime" }, ""), absent);
});

test("date: calendar components must survive Date rollover", () => {
  assert.deepEqual(resolve({ type: "date" }, "2024-02-29"), accepted("2024-02-29"));
  for (const value of ["2026-02-30", "0000-01-01", "2026-00-10", "2026-01-00", "2026-1-01", "20260101"]) {
    assert.deepEqual(resolve({ type: "date" }, value), rejected("invalid_date"), value);
  }
});

test("time: 24-hour clock with optional seconds and milliseconds", () => {
  for (const value of ["00:00", "23:59:59", "12:30:00.123"]) assert.deepEqual(resolve({ type: "time" }, value), accepted(value), value);
  for (const value of ["24:00", "12:60", "12:30:00.1234", "1230"]) assert.deepEqual(resolve({ type: "time" }, value), rejected("invalid_time"), value);
});

test("datetime: exactly one T between a valid date and a valid time", () => {
  assert.deepEqual(resolve({ type: "datetime" }, "2026-10-11T12:30"), accepted("2026-10-11T12:30"));
  for (const value of ["2026-10-11", "2026-10-11T12:30T1", "2026-02-30T12:30", "2026-10-11T25:00"]) {
    assert.deepEqual(resolve({ type: "datetime" }, value), rejected("invalid_datetime"), value);
  }
});

test("temporal: explicit and attribute bounds compare normalized instants", () => {
  assert.deepEqual(resolve({ type: "date", min: "2026-01-02" }, "2026-01-01"), rejected("below_min"));
  assert.deepEqual(resolve({ type: "date", attributes: { max: "2026-01-01" } }, "2026-01-02"), rejected("above_max"));
  assert.deepEqual(resolve({ type: "time", attributes: { min: "12:30:00.100" }, max: "12:30:00.1" }, "12:30:00.1"), accepted("12:30:00.1"));
  assert.deepEqual(resolve({ type: "datetime", max: "2026-01-01T12:30" }, "2026-01-01T12:31"), rejected("above_max"));
});

test("select/radio: one listed option, never an array", () => {
  assert.deepEqual(resolve({ type: "select", options: choices }, "a"), accepted("a"));
  assert.deepEqual(resolve({ type: "radio", options: choices, required: true }, ""), rejected("required"));
  assert.deepEqual(resolve({ type: "radio", options: choices }, ""), absent);
  assert.deepEqual(resolve({ type: "select", options: choices }, ["a"]), rejected("must be a string"));
  assert.deepEqual(resolve({ type: "select", options: choices }, "c"), rejected("invalid_option"));
  assert.deepEqual(resolve({ type: "select" }, "a"), rejected("invalid_option"));
});

test("multi-select/checkbox-group: a scalar becomes a one-value array", () => {
  assert.deepEqual(resolve({ type: "multi-select", options: choices }, "a"), accepted(["a"]));
  assert.deepEqual(resolve({ type: "checkbox-group", options: choices }, ["b", "a"]), accepted(["b", "a"]));
  assert.deepEqual(resolve({ type: "checkbox-group", options: choices }, []), accepted([]));
});

test("multi-select: the answer must be at most 100 strings", () => {
  for (const value of [5, [1], Array.from({ length: 101 }, () => "a")]) {
    assert.deepEqual(resolve({ type: "multi-select", options: choices }, value), rejected("must be a string array"));
  }
});

test("multi-select: required groups need one value; duplicates and unlisted values are refused", () => {
  assert.deepEqual(resolve({ type: "multi-select", options: choices, required: true }, []), rejected("required"));
  assert.deepEqual(resolve({ type: "multi-select", options: choices }, ["a", "a"]), rejected("invalid_option"));
  assert.deepEqual(resolve({ type: "multi-select", options: choices }, ["a", "c"]), rejected("invalid_option"));
  assert.deepEqual(resolve({ type: "multi-select" }, ["a"]), rejected("invalid_option"));
});

test("checkbox/toggle: native booleans and the 'on' spelling", () => {
  assert.deepEqual(resolve({ type: "checkbox" }, true), accepted(true));
  assert.deepEqual(resolve({ type: "toggle" }, false), accepted(false));
  assert.deepEqual(resolve({ type: "checkbox", required: true }, false), rejected("required"));
  assert.deepEqual(resolve({ type: "checkbox", required: true }, "on"), accepted(true));
  assert.deepEqual(resolve({ type: "checkbox" }, "off"), rejected("must be a boolean"));
});

test("checkbox: an authored value must be submitted exactly", () => {
  assert.deepEqual(resolve({ type: "checkbox", checkboxValue: "yes" }, "yes"), accepted("yes"));
  assert.deepEqual(resolve({ type: "checkbox", checkboxValue: "yes" }, "no"), rejected("invalid_option"));
  assert.deepEqual(resolve({ type: "checkbox", checkboxValue: "yes" }, true), rejected("must be a boolean"));
});

test("hidden: validated as text", () => {
  assert.deepEqual(resolve({ type: "hidden" }, {}), rejected("must be a string"));
});

test("file: the registry validator refuses without a host sniffer", () => {
  assert.deepEqual(FIELD_TYPE_REGISTRY.file.validate({ field: field({ type: "file" }), value: upload() }), rejected("file_storage_unavailable"));
  assert.deepEqual(resolveFormField({ field: field({ type: "file" }), value: upload() }), rejected("file_storage_unavailable"));
});

test("file: a safe upload resolves with the sniffed content type", () => {
  assert.deepEqual(resolveFile({}, upload()), { kind: "upload", file: upload() });
  assert.deepEqual(resolveFile({}, upload({ contentType: "", filename: "PHOTO.PNG" })), { kind: "upload", file: upload({ filename: "PHOTO.PNG" }) });
});

test("file: malformed inputs are invalid_file", () => {
  for (const value of ["photo.png", { ...upload(), bytes: [1] }, { ...upload(), filename: 1 }, { ...upload(), contentType: 1 }]) {
    assert.deepEqual(resolveFile({}, value), rejected("invalid_file"));
  }
});

test("file: empty, over-field-limit and over-ceiling uploads are file_size", () => {
  assert.deepEqual(resolveFile({}, upload({ bytes: new Uint8Array() })), rejected("file_size"));
  assert.deepEqual(resolveFile({ maxFileSize: 3 }, upload()), rejected("file_size"));
  assert.deepEqual(resolveFile({ maxFileSize: 4 }, upload()), { kind: "upload", file: upload() });
  const huge = new Uint8Array(MAX_FORM_FILE_BYTES + 1); huge[0] = 137;
  assert.deepEqual(resolveFile({ maxFileSize: MAX_FORM_FILE_BYTES * 2 }, upload({ bytes: huge })), rejected("file_size"));
});

test("file: long, path-bearing, control-character and dangerous filenames are file_type", () => {
  for (const filename of [`${"a".repeat(197)}.png`, "dir/photo.png", "dir\\photo.png", "photo\u0000.png", "photo.exe.png", "photo.svg"]) {
    assert.deepEqual(resolveFile({}, upload({ filename })), rejected("file_type"), filename);
  }
  assert.deepEqual(resolveFile({}, upload({ filename: `${"a".repeat(196)}.png` })), { kind: "upload", file: upload({ filename: `${"a".repeat(196)}.png` }) });
});

test("file: a claimed type that differs from the sniffed one is file_type", () => {
  assert.deepEqual(resolveFile({}, upload({ contentType: "image/gif" })), rejected("file_type"));
});

test("file: unsafe sniffed types and mismatched extensions are file_type", () => {
  assert.deepEqual(resolveFile({}, upload({ bytes: new Uint8Array([1]), contentType: "" })), rejected("file_type"));
  assert.deepEqual(resolveFile({}, upload({ filename: "photo.jpg" })), rejected("file_type"));
});

test("file: a filename with no dot passes when the whole name is a safe extension (reported, not fixed)", () => {
  assert.deepEqual(resolveFile({}, upload({ filename: "png" })), { kind: "upload", file: upload({ filename: "png" }) });
});

test("file: accept narrows by exact type, top-level wildcard or */*", () => {
  for (const accept of [["image/png"], ["image/*"], ["*/*"]]) assert.deepEqual(resolveFile({ accept }, upload()), { kind: "upload", file: upload() });
  assert.deepEqual(resolveFile({ accept: ["video/*", "image/gif"] }, upload()), rejected("file_type"));
});

test("isSafeFieldPattern: literals, classes and one repetition are safe", () => {
  for (const pattern of ["abc", "[a-z]+", "\\d{3}", "a\\+b+", "[+*?{]x"]) assert.equal(isSafeFieldPattern({ pattern }), true, pattern);
});

test("isSafeFieldPattern: groups, alternation, backreferences, properties, repetition stacks and bad syntax are unsafe", () => {
  for (const pattern of ["x".repeat(301), "(a)", "a|b", "\\1", "\\p{L}", "\\k<a>", "a+b+", ".*", "a{2}b*", "[a", "a{"]) {
    assert.equal(isSafeFieldPattern({ pattern }), false, pattern);
  }
});

test("isBrowserSafeFieldPattern: also refuses classes the browser's v flag rejects", () => {
  assert.equal(isBrowserSafeFieldPattern({ pattern: "[a-z\\-]+" }), true);
  assert.equal(isBrowserSafeFieldPattern({ pattern: "[a-z-]+" }), false);
  assert.equal(isBrowserSafeFieldPattern({ pattern: "(a)" }), false);
});
