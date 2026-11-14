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

  test('leaves the sanctioned routes alone', () => {
    expect(categories('logger.warn({ message: "save failed" }, { error });')).toEqual([]);
    expect(categories('logger.warn({ message: `save failed: ${describeErrorForLog({ err: error })}` }, { meta: { runId } });')).toEqual([]);
    expect(categories('io.warn("goto:", errorClassLabel({ error: e }));')).toEqual([]);
    expect(categories('throw new Error(`refused: ${reasonText}`, { cause: error });')).toEqual([]);
    expect(categories('const answer = { message: result.message };')).toEqual([]);
  });
});

describe('log-safety debt comparison', () => {
  const entry = (file: string, value: number) => ({ file, rule: 'console', value });

  test('reports added, worsened, improved and stale entries', () => {
    const result = compareLogSafetyDebt([entry('a.ts', 2), entry('b.ts', 2), entry('c.ts', 1)], [entry('a.ts', 3), entry('b.ts', 1), entry('d.ts', 1)]);
    expect(result.added).toEqual([entry('d.ts', 1)]);
    expect(result.worsened).toEqual([{ prior: entry('a.ts', 2), violation: entry('a.ts', 3) }]);
    expect(result.improved).toEqual([{ prior: entry('b.ts', 2), violation: entry('b.ts', 1) }]);
    expect(result.stale).toEqual([entry('c.ts', 1)]);
  });

  test('refuses an entry with an unknown rule or a non-positive count', () => {
    expect(() => compareLogSafetyDebt([{ file: 'a.ts', rule: 'other', value: 1 }], [])).toThrow(/Invalid debt list entry/);
    expect(() => compareLogSafetyDebt([], [entry('a.ts', 0)])).toThrow(/Invalid ESLint output entry/);
  });
});
