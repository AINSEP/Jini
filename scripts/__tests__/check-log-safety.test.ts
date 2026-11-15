import { Linter } from 'eslint';
import { describe, expect, test } from 'vitest';
import { compareLogSafetyDebt, logSafetyConfig, sanctionedConsoleModules } from '../check-log-safety.mjs';

// The gate replaces a hand-made row list, so each selector is pinned on the shapes the reviews
// found (and on the sanctioned shapes it must leave alone).
function categories(code: string, filename = 'packages/example/src/file.ts'): string[] {
  const messages = new Linter({ configType: 'flat' }).verify(code, logSafetyConfig(), { filename });
  return messages.map(message => {
    if (message.ruleId === 'no-console') return 'console';
    const match = /^log-safety\/([a-z-]+):/.exec(message.message);
    if (!match) throw new Error(`unexpected report: ${message.message}`);
    return match[1]!;
  }).sort();
}

describe('log-safety selectors', () => {
  test('flags error text, formatting, raw errors and helpers inside log calls', () => {
    expect(categories('logger.warn({ message: `failed: ${err.message}` });')).toEqual(['error-text']);
    expect(categories('deps.warn("goto:", e.stack);')).toEqual(['error-text']);
    expect(categories('logger.error({ message: `x ${inspect(error)}` });')).toEqual(['error-format', 'error-helper']);
    expect(categories('logger.error({ message: `x ${String(cause)}` });')).toEqual(['error-format']);
    expect(categories('log(`failed ${error}`);')).toEqual(['raw-error']);
    expect(categories('io.warn("failed", context.error);')).toEqual(['raw-error']);
    expect(categories('log({ message: messages.failed({ message: messageOf(error) }) });')).toEqual(['error-helper']);
    expect(categories('logger.info({ message: `x ${errorMessage(context.error)}` });')).toEqual(['error-helper']);
  });

  test('flags direct console use outside the sanctioned sinks, and raw errors handed to it', () => {
    expect(categories('console.error("failed", err);')).toEqual(['console', 'raw-error']);
    expect(categories('console.warn("plain words");')).toEqual(['console']);
    for (const filename of sanctionedConsoleModules) expect(categories('console.warn("plain words");', filename)).toEqual([]);
  });

  test('flags error text stored under error/detail/reason/cause fields', () => {
    expect(categories('const row = { error: e instanceof Error ? e.message : String(e) };')).toEqual(['stored-error-text', 'stored-error-text']);
    expect(categories('function row() { return { detail: loadError.stack }; }')).toEqual(['stored-error-text']);
  });

  // Review d5r4: member interpolation, `String(ctx.error)`, member-object stored text, a `report`
  // text sink and process stdio were invisible to rev 5.
  test('flags caught values reached through a member, in text sinks and stored fields', () => {
    expect(categories('logger.warn({ message: `failed ${ctx.error}` });')).toEqual(['raw-error']);
    expect(categories('logger.warn({ message: "failed " + ctx.error });')).toEqual(['raw-error']);
    expect(categories('log(`failed ${String(ctx.error)}`);')).toEqual(['error-format']);
    expect(categories('const row = { detail: String(ctx.error) };')).toEqual(['stored-error-text']);
    expect(categories('const row = { error: ctx.error.message };')).toEqual(['stored-error-text']);
    expect(categories('report(`${label} failed: ${error.message}`);')).toEqual(['error-text']);
    expect(categories('process.stderr.write(`failed: ${err.message}\\n`);')).toEqual(['error-text']);
    expect(categories('process.stdout.write(`failed: ${error}`);')).toEqual(['raw-error']);
  });

  // Review d5r6: an assignment store (`entry.error = error.message`, web-clone manifests) writes the
  // same text into an exported record as a property store does.
  test('flags error text assigned to a stored field', () => {
    expect(categories('entry.error = error.message;')).toEqual(['stored-error-text']);
    expect(categories('row.detail = ctx.error.stack;')).toEqual(['stored-error-text']);
    expect(categories('entry.error = errorClassLabel({ error });')).toEqual([]);
    expect(categories('entry.status = error.message ? "error" : "ok";')).toEqual([]);
  });

  // The raw error bag is the host's channel only on a core Logger port: object-first call on a
  // receiver named `logger`/`*Logger`. Anywhere else a nested raw value is printed as-is.
  test('flags raw caught values nested in a log call unless they sit in a Logger error bag', () => {
    expect(categories('deps.log("failed", { error });')).toEqual(['raw-error']);
    expect(categories('audit.warn({ message: "failed" }, { error });')).toEqual(['raw-error']);
    expect(categories('logger.warn("failed", { error });')).toEqual(['raw-error']);
    expect(categories('console.error("failed", { detail: err });')).toEqual(['console', 'raw-error']);
    expect(categories('logger.warn({ message: "failed" }, { meta: { detail: err } });')).toEqual(['raw-error']);
    expect(categories('logger.warn({ message: "failed", cause: ctx.error });')).toEqual(['raw-error']);
    expect(categories('logger.warn({ message: "failed" }, { meta: { error: err, runId } });')).toEqual([]);
    expect(categories('deps.logger.error({ message: "failed" }, { error: ctx.error });')).toEqual([]);
    expect(categories('this.auditLogger.warn({ message: "failed" }, { error });')).toEqual([]);
    expect(categories('required.warn({ message: "failed" }, { error });')).toEqual([]);
    expect(categories('deps.warn({ message: `failed: ${describeErrorForLog({ err: error })}` }, { error });')).toEqual([]);
    expect(categories('console.error("failed", describeErrorForLog({ err: sinkError }));')).toEqual(['console']);
    expect(categories('io.warn("goto:", errorClassLabel({ error: e }));')).toEqual([]);
    expect(categories('createConsoleLogger({ prefix: "" }).error({ message: "failed" }, { error: context.error });')).toEqual([]);
    expect(categories('createConsoleLogger({ prefix: "" }).error({ message: "failed" }, { error: redactSecrets({ input: inspect(context.error) }) });')).toEqual(['error-format', 'error-helper']);
  });

  // Review d5r6: the error-bag exemption trusts the receiver's name, so a `logger` typed as Console
  // (or defaulting to `console`) would print a raw Error and its stack under that exemption.
  test('flags a logger-named parameter or property typed Console or defaulting to console', () => {
    expect(categories('function f({ logger = console }: { logger?: Pick<Console, "info"> } = {}) {}')).toEqual(['console-logger', 'console-logger']);
    expect(categories('interface Options { logger?: Pick<Console, "error"> }')).toEqual(['console-logger']);
    expect(categories('function f(auditLogger: Console) {}')).toEqual(['console-logger']);
    expect(categories('class Host { logger: Console = console; }')).toEqual(['console-logger']);
    expect(categories('function f({ logger = createConsoleLogger({ prefix: "" }) }: { logger?: Logger } = {}) {}')).toEqual([]);
    expect(categories('interface Options { output?: Pick<Console, "log"> }')).toEqual([]);
  });

  test('leaves the sanctioned routes alone', () => {
    expect(categories('logger.warn({ message: "save failed" }, { error });')).toEqual([]);
    expect(categories('logger.warn({ message: `save failed: ${describeErrorForLog({ err: error })}` }, { meta: { runId } });')).toEqual([]);
    expect(categories('io.warn("goto:", errorClassLabel({ error: e }));')).toEqual([]);
    expect(categories('throw new Error(`refused: ${reasonText}`, { cause: error });')).toEqual([]);
    expect(categories('const answer = { message: result.message };')).toEqual([]);
    expect(categories('report({ connectionId, stage: "store", error });')).toEqual([]);
    expect(categories('process.stderr.write(text);')).toEqual([]);
  });
});

describe('log-safety debt comparison', () => {
  const entry = (file: string, value: number) => ({ file, rule: 'console', value });

  test('reports added, worsened, improved and stale entries', () => {
    const result = compareLogSafetyDebt({ debt: [entry('a.ts', 2), entry('b.ts', 2), entry('c.ts', 1)], current: [entry('a.ts', 3), entry('b.ts', 1), entry('d.ts', 1)] });
    expect(result.added).toEqual([entry('d.ts', 1)]);
    expect(result.worsened).toEqual([{ prior: entry('a.ts', 2), violation: entry('a.ts', 3) }]);
    expect(result.improved).toEqual([{ prior: entry('b.ts', 2), violation: entry('b.ts', 1) }]);
    expect(result.stale).toEqual([entry('c.ts', 1)]);
  });

  test('refuses an entry with an unknown rule or a non-positive count', () => {
    expect(() => compareLogSafetyDebt({ debt: [{ file: 'a.ts', rule: 'other', value: 1 }], current: [] })).toThrow(/Invalid debt list entry/);
    expect(() => compareLogSafetyDebt({ debt: [], current: [entry('a.ts', 0)] })).toThrow(/Invalid ESLint output entry/);
  });
});
