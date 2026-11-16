/**
 * @file The error gate's rules, run as the combined rule set on sites copied from production code
 * (each fixture names its source). A fixture is the try/catch as written, so the exemption is
 * proven on real shapes, not on shapes written to pass.
 */
import { Linter } from 'eslint';
import { expect, test } from 'vitest';
import { compareErrorGateDebt, errorGateConfig } from '../check-error-gate.mjs';

function findings(code: string, optional: { pureHelpers?: Array<{ name: string; module: string }> } = {}): string[] {
  const messages = new Linter({ configType: 'flat' }).verify(code, errorGateConfig({}, optional), { filename: 'packages/example/src/site.ts' });
  return messages.map(message => `${message.line}:${String(message.ruleId)}`);
}

test('a pure parse refusal passes as written (payments-stripe/http.ts:52, the inner try)', () => {
  expect(findings('let json: unknown;\ntry { json = JSON.parse(response.bodyText); } catch { json = null; }')).toEqual([]);
  expect(findings('function parse(text: string) {\n  try { return new URL(decodeURIComponent(text.trim())).pathname.split("/"); } catch { return null; }\n}')).toEqual([]);
});

test('a provider send whose transport error is never recorded is flagged (payments-stripe/http.ts:54, the outer try)', () => {
  expect(findings(`async function send() {
  try {
    const response = await ctx.httpClient.send({ request });
    let json: unknown;
    try { json = JSON.parse(response.bodyText); } catch { json = null; }
    return stripeOutcome({ status: response.status, json });
  } catch {
    return { kind: "unknown" };
  }
}`)).toEqual(['7:errors/catch-reads-error']);
});

test('a stream read reported with fixed words and no cause is flagged (agent-runtime providers/response-text.ts:19)', () => {
  expect(findings(`async function read(body: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  try {
    for await (const chunk of body) { chunks.push(chunk); }
  } catch {
    throw new Error('Provider response could not be read within the byte limit');
  }
}`)).toEqual(['5:errors/catch-reads-error']);
});

test('a body read hidden inside a parse is not a parse refusal (agent-plugins s3-compatible.mjs:414)', () => {
  expect(findings('async function body(resp) {\n  try { return JSON.parse(await resp.text()); } catch { throw new Error("not valid JSON"); }\n}')).toEqual(['2:errors/catch-reads-error']);
});

test('a call that is not a listed parser keeps the catch in scope, including a plugin-supplied parser (provider-contribution.ts:97)', () => {
  expect(findings('function run(parser, text) {\n  try { return parser(text); } catch { return { ok: false, reason: "its parser failed" }; }\n}')).toEqual(['2:errors/catch-reads-error']);
});

test('an empty catch is flagged even with a comment, and even around a pure parse', () => {
  expect(findings('try { JSON.parse(text); } catch { /* ignore */ }')).toEqual(['1:errors/catch-reads-error']);
});

test('a catch that reads the value passes; an unused binding does not', () => {
  expect(findings('async function f() { try { await save(); } catch (error) { reporter.record({ error, step: "Save" }); } }')).toEqual([]);
  expect(findings('async function f() { try { await save(); } catch ({ code }) { return code; } }')).toEqual([]);
  expect(findings('async function f() { try { await save(); } catch (error) { return null; } }')).toEqual(['1:errors/catch-reads-error']);
});

test('a .catch handler that ignores the error is flagged (queue tail: useComposerHistory.hooks.ts:112); one that reads it, or a named idiom, passes', () => {
  expect(findings('const tail = previous.catch(() => {}).then(() => storage.write(entry));')).toEqual(['1:errors/catch-reads-error']);
  expect(findings('void refresh().catch(function () { return undefined; });')).toEqual(['1:errors/catch-reads-error']);
  expect(findings('void refresh().catch(_error => undefined);')).toEqual(['1:errors/catch-reads-error']);
  expect(findings('void refresh().catch(error => logger.warn({ message: "refresh failed" }, { error }));')).toEqual([]);
  expect(findings('void refresh().catch(onError);')).toEqual([]);
  expect(findings('import { afterSettled, observed } from "@jini-ai/core/errors/idioms";\nobserved({ promise: refresh() });\nconst tail = afterSettled({ promise: previous }).then(() => storage.write(entry));')).toEqual([]);
});

test('a reviewed pure helper counts only when imported from its listed module', () => {
  const pureHelpers = [{ name: 'fromBase64Url', module: 'text/base64url' }];
  const site = (from: string) => `import { fromBase64Url } from "${from}";\nfunction read(token: string) { try { return JSON.parse(fromBase64Url(token)); } catch { return null; } }`;
  expect(findings(site('../text/base64url.js'), { pureHelpers })).toEqual([]);
  expect(findings(site('../io/fetch-token.js'), { pureHelpers })).toEqual(['2:errors/catch-reads-error']);
  expect(findings(site('../text/base64url.js'))).toEqual(['2:errors/catch-reads-error']);
});

test('generic failure words are flagged in strings and templates; a sentence that says what failed is not', () => {
  expect(findings('const a = "Something went wrong";\nconst b = `Request failed: ${status}`;\nconst c = "An unexpected error occurred.";\nconst d = "internal error";')).toEqual([
    '1:errors/no-generic-failure-text', '2:errors/no-generic-failure-text', '3:errors/no-generic-failure-text', '4:errors/no-generic-failure-text']);
  expect(findings('const a = "The site export could not be completed.";\nconst b = "Try the export again.";')).toEqual([]);
});

test('precedence: a pure parse refusal satisfies rule 1 while rule 2 still reads its words', () => {
  expect(findings('function parse(text: string) {\n  try { return JSON.parse(text); } catch { throw new Error("unknown error"); }\n}')).toEqual(['2:errors/no-generic-failure-text']);
});

test('the debt comparison reports new, worse, improved and gone entries by file and rule', () => {
  const entry = (file: string, value: number, rule = 'catch-reads-error') => ({ file, rule, value });
  const result = compareErrorGateDebt({
    debt: [entry('a.ts', 2), entry('b.ts', 3), entry('c.ts', 1), entry('d.ts', 1)],
    current: [entry('a.ts', 3), entry('b.ts', 1), entry('c.ts', 1), entry('e.ts', 1), entry('c.ts', 1, 'no-generic-failure-text')],
  });
  expect(result.added).toEqual([entry('e.ts', 1), entry('c.ts', 1, 'no-generic-failure-text')]);
  expect(result.worsened).toEqual([{ prior: entry('a.ts', 2), violation: entry('a.ts', 3) }]);
  expect(result.improved).toEqual([{ prior: entry('b.ts', 3), violation: entry('b.ts', 1) }]);
  expect(result.stale).toEqual([entry('d.ts', 1)]);
});
