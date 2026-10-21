import { expect, test } from "vitest";
import { redactSecretShapes, type RedactionPolicy, type RedactionRule } from "../secrets-only.js";

// Synthetic values are assembled so the repository's secret scanner does not flag fixtures.
const opaque = "q7R2" + "m9Z4p6T8v3X5n1K0";
const vendor = ["sk", "proj", ""].join("-") + "Ab3".repeat(8);
const oauth = "ya" + "29." + "a".repeat(24);
const sendgrid = "S" + "G." + "a".repeat(16) + "." + "b".repeat(16);
const codePolicy: RedactionPolicy = { codeAware: true };

test.each([
  ["short", opaque.slice(0, 19)],
  ["whitespace", "ab12 cd34 ef56 gh78 ij90"],
  ["no letters", "123456789012345678901"],
  ["no digits", "AbCdEfGhIjKlMnOpQrStUv"],
  ["punctuation", "ab12:cd34,ef56[gh78]ij90"],
  ["hex at lower boundary", "abcdef0123456789abcd"],
  ["hex at upper boundary", "abcdef0123456789".repeat(2) + "abcdef01"],
  ["slash-bearing path", "q7R2/m9Z4p6T8v3X5n1K0"],
  ["dotted identifier", "q7R2.m9Z4p6T8v3X5n1K0"],
  ["low entropy", "a1".repeat(20)],
  ["below entropy threshold", "aaaaabcdg01234567".repeat(2)],
])("code literals preserve %s values", (_label, content) => {
  const text = `const value = '${content}';`;
  expect(redactSecretShapes({ text, policy: codePolicy })).toEqual({ text, redactions: 0 });
});

test.each([
  ["opaque", opaque],
  ["non-hex key", "abcg01234567".repeat(2)],
  ["hex beyond hash exemption", "abcdef0123456789".repeat(3)],
  ["base64", "QWxhZGRpbjpvcGVuIHNlc2FtZQ=="],
  // Four occurrences of 'a' and twelve other symbols give exactly 3.5 bits per character.
  ["exact entropy threshold", "aaaabcdg01234567".repeat(2)],
])("code literals redact %s values as high entropy", (_label, content) => {
  expect(redactSecretShapes({ text: `const value = '${content}';`, policy: codePolicy })).toEqual({
    text: "const value = '[REDACTED:high_entropy]';", redactions: 1,
  });
});

test.each([
  ["bare value", "'abcdefgh'"],
  ["non-name", "1 = 'abcdefgh'"],
  ["ordinary name", "const message = 'abcdefgh'"],
  ["reference call", "token('abcdefgh')"],
  ["no callee", "('token', 'abcdefgh')"],
  ["grouping expression", "const pair = ('token', 'abcdefgh')"],
  ["later argument", "set(other, 'token', 'abcdefgh')"],
  ["computed first argument", "set('token' + suffix, 'abcdefgh')"],
  ["second unnamed value", "set('token', ref, 'abcdefgh')"],
  ["short named value", "const token = '1234567'"],
  ["spaced named value", "const token = 'two words'"],
  ["spaced scheme value", "const auth = 'Bearer two words'"],
  ["joined names", "const token = 'access_token_name'"],
  ["dotted names", "const token = 'auth.token.label'"],
  ["scheme and joined names", "const auth = 'Bearer upload-token'"],
  ["existing marker", "const token = '[REDACTED:labeled_secret]'"],
  ["interpolation reference", "const token = `Bearer ${config.token}`"],
  ["empty template head", "const token = `${config.token}`"],
])("code adjacency preserves %s", (_label, text) => {
  expect(redactSecretShapes({ text, policy: codePolicy })).toEqual({ text, redactions: 0 });
});

test.each(["if", "while", "for", "switch", "catch", "with", "function"])(
  "code adjacency excludes the %s keyword as a callee", callee => {
    const text = `${callee} ('token', 'abcdefgh') {}`;
    expect(redactSecretShapes({ text, policy: codePolicy })).toEqual({ text, redactions: 0 });
  },
);

test.each([
  ["assignment", "const token = 'abcdefgh'", "const token = '[REDACTED:labeled_secret]'"],
  ["property", "{ token: 'abcdefgh' }", "{ token: '[REDACTED:labeled_secret]' }"],
  ["quoted property", "{ 'token': 'abcdefgh' }", "{ 'token': '[REDACTED:labeled_secret]' }"],
  ["named argument", "set('token', 'abcdefgh')", "set('token', '[REDACTED:labeled_secret]')"],
  ["returned callee", "factory()('token', 'abcdefgh')", "factory()('token', '[REDACTED:labeled_secret]')"],
  ["indexed callee", "handlers[0]('token', 'abcdefgh')", "handlers[0]('token', '[REDACTED:labeled_secret]')"],
  ["ignored trivia", "set(/* key */ 'token' /* gap */,\n/* value */ 'abcdefgh')", "set(/* key */ 'token' /* gap */,\n/* value */ '[REDACTED:labeled_secret]')"],
  ["scheme", "const auth = 'Basic abcdefgh'", "const auth = '[REDACTED:labeled_secret]'"],
  ["template", "const token = `abcdefgh`", "const token = `[REDACTED:labeled_secret]`"],
  ["template head", "const token = `abcdefgh${ref}`", "const token = `[REDACTED:labeled_secret]${ref}`"],
])("code adjacency redacts %s values once", (_label, text, expected) => {
  const first = redactSecretShapes({ text, policy: codePolicy });
  expect(first).toEqual({ text: expected, redactions: 1 });
  expect(redactSecretShapes({ text: first.text, policy: codePolicy })).toEqual({ text: expected, redactions: 0 });
});

test.each([
  ["single quote", `const value = '${opaque}';`, "const value = '[REDACTED:high_entropy]';"],
  ["double quote", `const value = "${opaque}";`, 'const value = "[REDACTED:high_entropy]";'],
  ["unclosed quote", `const value = '${opaque}`, "const value = '[REDACTED:high_entropy]"],
  ["static template", "const value = `" + opaque + "`;", "const value = `[REDACTED:high_entropy]`;"],
  ["unclosed template", "const value = `" + opaque, "const value = `[REDACTED:high_entropy]"],
  ["head", "const value = `" + opaque + "${ref}`;", "const value = `[REDACTED:high_entropy]${ref}`;"],
  ["middle", "const value = `${a}" + opaque + "${b}`;", "const value = `${a}[REDACTED:high_entropy]${b}`;"],
  ["tail", "const value = `${ref}" + opaque + "`;", "const value = `${ref}[REDACTED:high_entropy]`;"],
  ["JSX string", `<Widget value="${opaque}" />`, '<Widget value="[REDACTED:high_entropy]" />'],
  ["TS angle assertion", `const value = <string>'${opaque}';`, "const value = <string>'[REDACTED:high_entropy]';"],
  ["literal after JSX", `const view = <Widget />; const value = '${opaque}';`, "const view = <Widget />; const value = '[REDACTED:high_entropy]';"],
  ["nested literal", "const value = `prefix ${'" + opaque + "'}`;", "const value = `prefix ${'[REDACTED:high_entropy]'}`;"],
])("code token spans preserve %s delimiters", (_label, text, expected) => {
  expect(redactSecretShapes({ text, policy: codePolicy })).toEqual({ text: expected, redactions: 1 });
});

test.each([
  ["line comment", `// ${vendor}\nconst value = ref;`, "// [REDACTED:openai_key]\nconst value = ref;"],
  ["block comment", `/* ${vendor} */`, "/* [REDACTED:openai_key] */"],
  ["hashbang", `#!/bin/tool ${vendor}\n`, "#!/bin/tool [REDACTED:openai_key]\n"],
  ["strict comment", "// password=hunter2", "// password=[REDACTED:labeled_secret]"],
  ["vendor literal", `const token = '${vendor}';`, "const token = '[REDACTED:openai_key]';"],
  ["OAuth literal", `const token = '${oauth}';`, "const token = '[REDACTED:google_oauth]';"],
  ["SendGrid comment", `// ${sendgrid}`, "// [REDACTED:sendgrid_key]"],
])("code tokens keep %s rule precedence and counts", (_label, text, expected) => {
  const first = redactSecretShapes({ text, policy: codePolicy });
  expect(first).toEqual({ text: expected, redactions: 1 });
  expect(redactSecretShapes({ text: first.text, policy: codePolicy })).toEqual({ text: expected, redactions: 0 });
});

test.each([
  `// ${opaque}`, `/* ${opaque} */`, `#!/bin/tool ${opaque}\n`,
  `const expression = /${opaque}/;`, "const token = config.token;",
])("code tokens preserve nonliteral entropy: %s", text => {
  expect(redactSecretShapes({ text, policy: codePolicy })).toEqual({ text, redactions: 0 });
});

test("independent code tokens do not inherit a prior secret label", () => {
  const text = "{ token: 'abcdefgh', message: 'ijklmnop', password: 'qrstuvwx' }";
  expect(redactSecretShapes({ text, policy: codePolicy })).toEqual({
    text: "{ token: '[REDACTED:labeled_secret]', message: 'ijklmnop', password: '[REDACTED:labeled_secret]' }",
    redactions: 2,
  });
});

test.each([{}, { codeAware: true }, { vendorOnly: true }])("empty input bypasses all rules for %j", policy => {
  const additionalRules: readonly RedactionRule[] = [{
    kind: "empty", pattern: /^$/, replacement: () => "should not run",
  }];
  expect(redactSecretShapes({ text: "", policy: { ...policy, additionalRules } })).toEqual({ text: "", redactions: 0 });
});

test.each([{}, { codeAware: true }, { vendorOnly: true }])("caller rules replace every match without changing pattern state for %j", policy => {
  const pattern = /host_([a-z0-9]+)/;
  pattern.lastIndex = 7;
  const additionalRules: readonly RedactionRule[] = [{
    kind: "host", pattern, replacement: ({ match }) => `[REDACTED:host:${match[1]}]`,
  }];
  expect(redactSecretShapes({ text: "'host_one host_two'", policy: { ...policy, additionalRules } })).toEqual({
    text: "'[REDACTED:host:one] [REDACTED:host:two]'", redactions: 2,
  });
  expect(pattern.lastIndex).toBe(7);
});

test("vendor rules precede caller formats, which precede contextual rules", () => {
  const additionalRules: readonly RedactionRule[] = [{
    kind: "host", pattern: /sk-proj-[A-Za-z0-9_-]{20,}|host_[a-z]+/g,
    replacement: () => "[REDACTED:host]",
  }];
  expect(redactSecretShapes({ text: `${vendor} token=host_abcdefgh`, policy: { additionalRules } })).toEqual({
    text: "[REDACTED:openai_key] token=[REDACTED:host]", redactions: 2,
  });
});

test("vendor-only policy takes precedence over code-aware scanning and retains caller rules", () => {
  const additionalRules: readonly RedactionRule[] = [{
    kind: "host", pattern: /host_[a-z]+/g, replacement: () => "[REDACTED:host]",
  }];
  const text = `token='abcdefgh'; const value = '${opaque}'; ${vendor} ${oauth} ${sendgrid} host_abcdefgh`;
  expect(redactSecretShapes({ text, policy: { codeAware: true, vendorOnly: true, additionalRules } })).toEqual({
    text: `token='abcdefgh'; const value = '${opaque}'; [REDACTED:openai_key] [REDACTED:google_oauth] [REDACTED:sendgrid_key] [REDACTED:host]`,
    redactions: 4,
  });
});

test("plain text preserves dotted code-vendor formats without an explicit opt-in", () => {
  const text = `${oauth} ${sendgrid}`;
  expect(redactSecretShapes({ text, policy: {} })).toEqual({ text, redactions: 0 });
});

test.each(["sk\\x2dproj-", "sk\\u002dproj-", "\\u{73}k-proj-", "\\163k-proj-"])("redacts escaped static vendor credentials: %s", prefix => {
  const text = "const value = '" + prefix + "Ab3".repeat(8) + "';";
  const result = redactSecretShapes({ text, policy: codePolicy });
  expect(result).toEqual({ text: "const value = '[REDACTED:openai_key]';", redactions: 1 });
  expect(redactSecretShapes({ text: result.text, policy: codePolicy })).toEqual({ ...result, redactions: 0 });
});

test("preserves nonsecret escaped spelling and decodes escaped secret labels", () => {
  const text = String.raw`const value = 'hello\nworld';`;
  expect(redactSecretShapes({ text, policy: codePolicy })).toEqual({ text, redactions: 0 });
  expect(redactSecretShapes({ text: String.raw`{ 'to\x6ben': 'abcdefgh' }`, policy: codePolicy })).toEqual({
    text: String.raw`{ 'to\x6ben': '[REDACTED:labeled_secret]' }`, redactions: 1,
  });
});

test('keeps escaped-secret replacements valid inside their original delimiters', () => {
  const text = "const value = 'prefix\\n" + "sk\\x2dproj-" + "Ab3".repeat(8) + "';";
  expect(redactSecretShapes({ text, policy: codePolicy })).toEqual({
    text: "const value = '[REDACTED:openai_key]';", redactions: 1,
  });
});
