import { describe, expect, it } from 'vitest';
import { createPrefixSourceClassifier, createSearchEnricher } from '../search-enricher.js';

const marker = ' | vocab: ';
const enricher = createSearchEnricher({
  marker,
  keywords: { known: 'dictionary words' },
  questions: { known: ['How do I a?', 'How do I b?'] },
});

describe('createSearchEnricher', () => {
  it('rejects an empty marker with a message naming the marker', () => {
    expect(() => createSearchEnricher({ marker: '', keywords: {}, questions: {} })).toThrow('search vocabulary marker must not be empty');
  });

  describe('indexedDescription', () => {
    it('returns the description unchanged when the id has no vocabulary anywhere', () => {
      expect(enricher.indexedDescription({ id: 'unknown', description: 'Plain' }, { includeDoc2query: true })).toBe('Plain');
    });

    it('returns an empty description unchanged when there is no tail', () => {
      expect(enricher.indexedDescription({ id: 'unknown', description: '' }, { includeDoc2query: true })).toBe('');
    });

    it('appends dictionary keywords and questions behind the marker when doc2query is on', () => {
      expect(enricher.indexedDescription({ id: 'known', description: 'Desc' }, { includeDoc2query: true }))
        .toBe('Desc | vocab: dictionary words How do I a? How do I b?');
    });

    it('omits questions when doc2query is off', () => {
      expect(enricher.indexedDescription({ id: 'known', description: 'Desc' }, { includeDoc2query: false }))
        .toBe('Desc | vocab: dictionary words');
    });

    it('returns only the tail (no marker) when the description is empty', () => {
      expect(enricher.indexedDescription({ id: 'known', description: '' }, { includeDoc2query: false })).toBe('dictionary words');
    });

    it('prefers registered metadata keywords and queries over the dictionaries', () => {
      const metadata = { search: { keywords: 'meta words', queries: ['Meta q?'] } };
      expect(enricher.indexedDescription({ id: 'known', description: 'Desc', metadata }, { includeDoc2query: true }))
        .toBe('Desc | vocab: meta words Meta q?');
    });

    it('lets empty metadata keywords/queries suppress the dictionary fallback (empty is not nullish)', () => {
      const metadata = { search: { keywords: '', queries: [] } };
      expect(enricher.indexedDescription({ id: 'known', description: 'Desc', metadata }, { includeDoc2query: true })).toBe('Desc');
    });

    it('falls back to the dictionary when metadata has no search block', () => {
      expect(enricher.indexedDescription({ id: 'known', description: 'Desc', metadata: {} }, { includeDoc2query: false }))
        .toBe('Desc | vocab: dictionary words');
    });

    it('uses queries alone when there are no keywords', () => {
      const onlyQuestions = createSearchEnricher({ marker, keywords: {}, questions: { q: ['Only?'] } });
      expect(onlyQuestions.indexedDescription({ id: 'q', description: 'D' }, { includeDoc2query: true })).toBe('D | vocab: Only?');
    });

    it('never reads inherited object keys as vocabulary (own-property lookup only)', () => {
      expect(enricher.indexedDescription({ id: 'toString', description: 'D' }, { includeDoc2query: true })).toBe('D');
      expect(enricher.indexedDescription({ id: '__proto__', description: 'D' }, { includeDoc2query: true })).toBe('D');
    });
  });

  describe('authoredDescription', () => {
    it('returns text without a marker unchanged', () => {
      expect(enricher.authoredDescription({ description: 'Plain' })).toBe('Plain');
    });

    it('strips everything from the first marker onward', () => {
      expect(enricher.authoredDescription({ description: 'Desc | vocab: words | vocab: more' })).toBe('Desc');
    });

    it('returns an empty string when the description starts with the marker', () => {
      expect(enricher.authoredDescription({ description: ' | vocab: words' })).toBe('');
    });
  });
});

describe('createPrefixSourceClassifier', () => {
  it('rejects an empty separator', () => {
    expect(() => createPrefixSourceClassifier({ separator: '', fallbackSource: 'host' })).toThrow('source separator and fallback must not be empty');
  });

  it('rejects an empty fallback source', () => {
    expect(() => createPrefixSourceClassifier({ separator: '.', fallbackSource: '' })).toThrow('source separator and fallback must not be empty');
  });

  it('classifies by the prefix before the separator', () => {
    expect(createPrefixSourceClassifier({ separator: '.', fallbackSource: 'host' }).classify({ id: 'pkg.tool' })).toBe('pkg');
  });

  it('uses the fallback when the prefix is empty', () => {
    expect(createPrefixSourceClassifier({ separator: '.', fallbackSource: 'host' }).classify({ id: '.orphan' })).toBe('host');
  });
});
