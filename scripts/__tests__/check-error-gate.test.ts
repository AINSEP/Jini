/**
 * @file The error gate's rules, run as the combined rule set on sites copied from production code.
 *
 * `fixtures/error-gate/sites.json` holds the whole try/catch (or the `.catch` statement) of each
 * site the design names, copied as written: the parse refusals that must pass, the sites that looked
 * like parse refusals and are not, one site per named idiom, and the fixed-message and dropped-cause
 * sites. `findings` is every finding of the three rules on that copy, as `line:rule`. The exemption
 * is proven on real shapes, not on shapes written to pass.
 */
import { readFileSync } from 'node:fs';
import { Linter } from 'eslint';
import { expect, test } from 'vitest';
import { compareErrorGateDebt, errorGateConfig, findErrorGateViolations, sanctionedModules } from '../check-error-gate.mjs';

interface CopiedSite { site: string; kind: string; expect: 'passes' | 'flagged'; catchLine: number; findings: string[]; imports: string[]; code: string }
const copiedSites = JSON.parse(readFileSync(new URL('./fixtures/error-gate/sites.json', import.meta.url), 'utf8')) as CopiedSite[];

function findings(code: string, optional: { pureHelpers?: Array<{ name: string; module: string }>; filename?: string } = {}): string[] {
  const messages = new Linter({ configType: 'flat' }).verify(code, errorGateConfig({}, optional), { filename: optional.filename ?? 'packages/example/src/site.ts' });
  return messages.map(message => `${message.line}:${String(message.ruleId)}`);
}

/** Lints one copied site under its own path (a reviewed helper is matched by path) with the gate's real helper list. */
function copiedSiteFindings(site: CopiedSite): string[] {
  const source = [...site.imports, 'async function* copied() {', site.code, '}'].join('\n');
  const messages = new Linter({ configType: 'flat' }).verify(source, errorGateConfig(), { filename: site.site.slice(0, site.site.lastIndexOf(':')) });
  return messages.map(message => (message.fatal ? `fatal: ${message.message}` : `${message.line - site.imports.length - 1}:${String(message.ruleId).replace('errors/', '')}`));
}

test.each(copiedSites)('copied site $site ($kind) $expect rule 1, and the three rules find exactly what is recorded', site => {
  const found = copiedSiteFindings(site);
  expect(found).toEqual(site.findings);
  expect(found.includes(`${site.catchLine}:catch-reads-error`)).toBe(site.expect === 'flagged');
});

test('the copied corpus is the population the design names for this repository', () => {
  const count = (kind: string, expectation: string) => copiedSites.filter(site => site.kind === kind && site.expect === expectation).length;
  // 48 of the design's 75 passing parse refusals and 5 of its 7 failing ones are in this repository; the rest are host sites.
  expect({ passing: count('parse-refusal', 'passes'), failing: count('not-a-parse-refusal', 'flagged'), flaggedParse: count('parse-refusal', 'flagged') })
    .toEqual({ passing: 48, failing: 5, flaggedParse: 0 });
  expect(copiedSites.filter(site => site.kind === 'idiom-site').map(site => (site as CopiedSite & { note: string }).note).sort()).toEqual([
    'idiom site: absentWhen', 'idiom site: afterSettled', 'idiom site: bestEffort', 'idiom site: observed', 'idiom site: orFallback', 'idiom site: orFallbackSync']);
});

test('precedence step 2 on copied sites: a parse refusal that throws fixed words without a cause passes rules 1 and 3', () => {
  const sanitised = copiedSites.filter(site => site.kind === 'parse-refusal' && /throw new \w+\(/.test(site.code.slice(site.code.lastIndexOf('catch'))));
  expect(sanitised.length).toBeGreaterThanOrEqual(20);
  for (const site of sanitised) expect(copiedSiteFindings(site).filter(finding => finding.startsWith(`${site.catchLine}:`) || finding.endsWith(':failure-text-from-catalog'))).toEqual([]);
  // The same catch is in scope again the moment its try block stops being a pure parse.
  const listPage = copiedSites.find(site => site.site === 'packages/core/src/list-page.ts:69')!;
  expect(copiedSiteFindings({ ...listPage, code: listPage.code.replace('JSON.parse(', 'JSON.parse(await ') })).toEqual(['3:catch-reads-error', '4:failure-text-from-catalog']);
});

test('each idiom site, rewritten with its idiom, passes all three rules', () => {
  const rewritten = `import { absentWhen, afterSettled, bestEffort, observed, orFallback, orFallbackSync } from "@jini-ai/core/errors/idioms";
async function sites() {
  observed({ promise: actions().toggle(rule) });
  writes = afterSettled({ promise: operation });
  const body: unknown = await orFallback({ work: () => response.json(), fallback: null, step: "Read the error body of a failed chat request" });
  orFallbackSync({ work: () => { required.storage.removeItem(key); orderId = null; return "Buy again"; }, fallback: "Check paid order", step: "Forget the finished order" });
  await bestEffort({ work: async () => { const handle = await open(dir, "r"); try { await handle.sync(); } finally { await handle.close(); } }, step: "Flush the plugin directory", logger });
  const installed = await absentWhen({ work: () => required.readFile({ pluginId: required.pluginId, relativePath: required.relativePath }), codes: ["ENOENT"] });
}`;
  expect(findings(rewritten)).toEqual([]);
});

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
}`)).toEqual(['5:errors/catch-reads-error', '6:errors/failure-text-from-catalog']);
});

test('a body read hidden inside a parse is not a parse refusal (agent-plugins s3-compatible.mjs:414)', () => {
  expect(findings('async function body(resp) {\n  try { return JSON.parse(await resp.text()); } catch { throw new Error("not valid JSON"); }\n}')).toEqual(['2:errors/catch-reads-error', '2:errors/failure-text-from-catalog']);
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

test('a reviewed helper private to its own file counts in that file only', () => {
  const pureHelpers = [{ name: 'fromBase64Url', module: 'packages/core/src/list-page' }];
  const site = 'function read(token: string) { try { return JSON.parse(fromBase64Url(token)); } catch { return null; } }';
  expect(findings(site, { pureHelpers, filename: 'packages/core/src/list-page.ts' })).toEqual([]);
  expect(findings(site, { pureHelpers, filename: 'packages/core/src/other-page.ts' })).toEqual(['1:errors/catch-reads-error']);
  // A different function imported under the listed name shadows the file's own.
  expect(findings(`import { fromBase64Url } from "./io.js";\n${site}`, { pureHelpers, filename: 'packages/core/src/list-page.ts' })).toEqual(['2:errors/catch-reads-error']);
});

test('a static call on a named owner is pure only when listed, never by its member name', () => {
  expect(findings('function f(key: string) { try { return Buffer.from(key, "base64").toString("utf8"); } catch { return null; } }')).toEqual([]);
  expect(findings('function f(key: string) { try { return Storage.get(key); } catch { return null; } }')).toEqual(['1:errors/catch-reads-error']);
  expect(findings('function f(value: string) { try { return MEDIA_EXT.test(new URL(value).pathname); } catch { return false; } }')).toEqual([]);
});

test('rule 3: failure words written in a catch for a 5xx answer or an error state are flagged; a code, a 4xx refusal and words outside a catch are not', () => {
  expect(findings('async function f(res) { try { await save(); } catch (error) { logger.error({ message: "save" }, { error }); res.status(500).json({ error: "Could not save the form", code: "INTERNAL_ERROR" }); } }'))
    .toEqual(['1:errors/failure-text-from-catalog']);
  expect(findings('async function f(res) { try { await save(); } catch (error) { const failure = reporter.describe({ error, step, scope, fallback }); res.status(500).json({ error: failure.error, code: "INTERNAL_ERROR" }); } }')).toEqual([]);
  expect(findings('async function f(res) { try { await save(); } catch (error) { note(error); res.status(400).json({ error: "The name is required." }); } }')).toEqual([]);
  expect(findings('async function f() { try { await load(); } catch (error) { note(error); setLoadError("Could not load the list"); store.set({ patch: { error: `Could not load ${name}` } }); } }'))
    .toEqual(['1:errors/failure-text-from-catalog', '1:errors/failure-text-from-catalog']);
  expect(findings('function f(res) { setLoadError("Could not load the list"); res.status(500).json({ error: "Could not save the form" }); }')).toEqual([]);
  expect(findings('void load().catch(error => { note(error); setError("Could not load the list"); });')).toEqual(['1:errors/failure-text-from-catalog']);
});

test('rule 3: a new error built in a catch needs { cause }, unless the catch hands the caught value to the reporter, a logger or an idiom', () => {
  const site = (body: string) => `async function f() { try { await send(); } catch (error) { ${body} } }`;
  expect(findings(site('if (isAbort(error)) return; throw new SendError("The message could not be sent.");'))).toEqual(['1:errors/failure-text-from-catalog']);
  expect(findings(site('if (isAbort(error)) return; return { ok: false, error: new SendError({ message: "The message could not be sent." }) };'))).toEqual(['1:errors/failure-text-from-catalog']);
  expect(findings(site('throw new SendError("The message could not be sent.", { cause: error });'))).toEqual([]);
  expect(findings(site('throw new SendError({ message: "The message could not be sent.", cause: error });'))).toEqual([]);
  expect(findings(site('reporter.record({ error, step: "Send the message" }); throw new SendError("The message could not be sent.");'))).toEqual([]);
  expect(findings(site('deps.logger.warn({ message: "send" }, { error }); throw new SendError("The message could not be sent.");'))).toEqual([]);
  expect(findings(site('observed({ promise: Promise.reject(error) }); throw new SendError("The message could not be sent.");'))).toEqual([]);
  // Reading the value somewhere else is not handing it over, and a recording call that never receives it does not count.
  expect(findings(site('if (isAbort(error)) return; logger.warn({ message: "send" }); throw new SendError("The message could not be sent.");'))).toEqual(['1:errors/failure-text-from-catalog']);
  expect(findings(site('throw new SendError({ code: "SEND_FAILED" });'))).toEqual(['1:errors/catch-reads-error']);
});

test('precedence step 1: a sanctioned reporting module is skipped by every rule', async () => {
  expect(sanctionedModules).toContain('packages/core/src/errors/reporter.ts');
  await expect(findErrorGateViolations({}, { files: ['packages/core/src/errors/reporter.ts'] }))
    .rejects.toThrow('None of these is a production source file the gate covers: packages/core/src/errors/reporter.ts');
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
