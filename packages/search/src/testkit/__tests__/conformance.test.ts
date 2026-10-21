import { describe, expect, test } from 'vitest';
import { runSearchProviderConformance } from '../conformance.js';
import { createInMemorySearchProvider, type InMemorySearchProviderOptions } from '../memory-provider.js';
import { isUp, memoryContext } from './helpers.js';

const variants: readonly [string, InMemorySearchProviderOptions][] = [
  ['sync restricted', {}],
  ['async restricted', { asyncIndexing: true }],
  ['sync public-only typo', { acceptsRestricted: false, typoTolerance: true, maxBatch: 2 }],
  ['async public-only single-locale', { acceptsRestricted: false, asyncIndexing: true, locales: ['de'] }],
  ['sync no locales', { locales: [] }],
];

for (const [name, options] of variants) {
  describe(name, () => {
    const titles = runSearchProviderConformance({
      name, test,
      makeProvider: () => createInMemorySearchProvider({}, { ...options, available: isUp }),
      makeContext: input => memoryContext(input),
    }, { makeUnavailableContext: input => memoryContext(input, { down: true }) });
    test('registers the capability-dependent cases', () => {
      expect(titles.some(title => title.endsWith('tolerates a one-edit typo'))).toBe(options.typoTolerance === true);
      expect(titles.some(title => title.endsWith('locale filter'))).toBe(options.locales?.length !== 0);
      expect(titles.some(title => title.includes('public-only provider'))).toBe(options.acceptsRestricted === false);
      expect(titles.at(-1)).toBe(`${name} › an unavailable backend answers unknown and never throws`);
    });
  });
}

test('without makeUnavailableContext the unavailable case is not registered', () => {
  const titles: string[] = [];
  const returned = runSearchProviderConformance({
    name: 'plain', makeProvider: () => createInMemorySearchProvider(), makeContext: input => memoryContext(input),
    test: title => { titles.push(title); },
  });
  expect(returned).toEqual(titles);
  expect(titles).toHaveLength(15);
  expect(titles.every(title => title.startsWith('plain › '))).toBe(true);
  expect(titles.some(title => title.includes('unavailable'))).toBe(false);
});
