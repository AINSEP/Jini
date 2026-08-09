import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isValidElementHandle } from '../element-handles.js';

/**
 * REF-004 — the `data-agent-element` handle grammar is declared in two packages.
 *
 * `@jini-ai/vibecoding`'s `html/regions.ts` restates this module's grammar rather than importing
 * it, and says so in its own comment: importing would give `/html` a dependency on this package
 * for one regular expression. That trade is deliberate and worth keeping — `@jini-ai/vibecoding`
 * has no `@jini-ai/*` runtime dependencies at all, and spending that on a regex is a bad deal.
 *
 * What is NOT acceptable is the two drifting. Both gate an allowlist: here it stops a caller's
 * handle from breaking out of the attribute selector it is interpolated into; there it stops a
 * model from publishing a new `data-agent-element` and thereby extending its own set of editable
 * regions. If one side widens and the other does not, the two disagree about what is addressable
 * and one of them is wrong.
 *
 * So this reads the other package's source and reconstructs its grammar rather than importing it —
 * no dependency edge, runtime or dev, in either direction. The extraction is deliberately strict:
 * if that file renames or restructures these declarations, this test fails loudly, which is
 * exactly the "must be revisited deliberately" the other module asks for.
 */
const REGIONS_SOURCE_PATH = fileURLToPath(
  new URL('../../../../vibecoding/src/html/regions.ts', import.meta.url),
);

function extractRegionGrammar(): { test: (handle: string) => boolean } {
  const source = readFileSync(REGIONS_SOURCE_PATH, 'utf8');

  const patternMatch = /^const HANDLE_PATTERN = \/(.+)\/;$/m.exec(source);
  const lengthMatch = /^const MAX_HANDLE_LENGTH = (\d+);$/m.exec(source);

  // Not `expect` calls: a failure here means the extraction is stale, not that the grammars
  // disagree, and the two deserve different messages.
  if (!patternMatch || !lengthMatch) {
    throw new Error(
      `could not extract the handle grammar from ${REGIONS_SOURCE_PATH}. It was restructured or `
      + 'renamed. Re-read it, confirm the grammar still matches this package\'s, and update the '
      + 'extraction below — do not delete this test.',
    );
  }

  const pattern = new RegExp(patternMatch[1] as string);
  const maxLength = Number(lengthMatch[1]);
  return {
    test: (handle: string) => handle.length > 0 && handle.length <= maxLength && pattern.test(handle),
  };
}

describe('data-agent-element handle grammar is identical in @jini-ai/agentic and @jini-ai/vibecoding', () => {
  const region = extractRegionGrammar();

  const CASES: readonly string[] = [
    // Accepted today.
    'hero', 'a', 'x1', 'main-content', 'a-b-c', 'x-1', '0', 'x'.repeat(128),
    // Rejected on shape.
    '', 'Hero', 'HERO', 'a--b', '-a', 'a-', '-', 'a_b', 'a.b', 'a b',
    // Rejected on length.
    'x'.repeat(129), 'x'.repeat(1000),
    // The cases the grammar exists for: anything that could break out of
    // `[data-agent-element="<handle>"]` or reach a wider selector.
    'a"]', 'a"] , [data-agent-element="b', "a']", 'a\\b', 'a\tb', 'a\nb',
    'a[b', 'a]b', 'a*b', 'a>b', 'a,b', 'a:hover', '*', '[data-agent-element]',
  ];

  it.each(CASES)('agrees on %j', (handle) => {
    expect(region.test(handle)).toBe(isValidElementHandle(handle));
  });

  it('covers both verdicts, so a grammar that accepted or rejected everything would not pass silently', () => {
    const verdicts = CASES.map((h) => isValidElementHandle(h));
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });
});
