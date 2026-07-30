import { describe, expect, it, vi } from 'vitest';

import { ask } from '../ask.js';
import { SITE_ITEMS, type SchemaOrgItem } from '../items.js';
import { retrieve, tokenize } from '../retrieve.js';

describe('tokenize', () => {
  it('lowercases, drops stop words and punctuation', () => {
    expect(tokenize('How often should I water the plants?')).toEqual(['often', 'water', 'plant']);
  });

  it('singularises words longer than three characters only', () => {
    // "plants" -> "plant" so a query matches an item that says "plant"; but "was"/"is" must not
    // be mangled into nonsense, which is why the length floor exists.
    expect(tokenize('plants notes')).toEqual(['plant', 'note']);
    expect(tokenize('gas')).toEqual(['gas']);
  });

  it('returns nothing for a query made only of stop words', () => {
    expect(tokenize('what is the')).toEqual([]);
  });
});

describe('retrieve', () => {
  it('ranks the watering FAQ first for a watering question', () => {
    const results = retrieve(SITE_ITEMS, 'how often should I water the window plants?');
    expect(results[0]?.item['@id']).toBe('urn:faq-watering');
    expect(results[0]?.matchedTerms).toContain('water');
  });

  it('finds a product when the question is about buying something', () => {
    const results = retrieve(SITE_ITEMS, 'brass watering can with a long spout');
    expect(results[0]?.item['@type']).toBe('Product');
    expect(results[0]?.item['@id']).toBe('urn:product-watering-can');
  });

  it('ranks the coffee article first for a brewing question', () => {
    expect(retrieve(SITE_ITEMS, 'why grind coffee just before brewing')[0]?.item['@id'])
      .toBe('urn:coffee-method');
  });

  it('returns nothing rather than a weak guess when no term matches', () => {
    // The behavior that matters for honesty: an unrelated question yields nothing, so the
    // caller can say "I don't have anything on that" instead of presenting a bad match.
    expect(retrieve(SITE_ITEMS, 'quarterly revenue forecast')).toEqual([]);
    expect(retrieve(SITE_ITEMS, 'what is the')).toEqual([]);
  });

  it('honours the limit and returns results in descending score', () => {
    const results = retrieve(SITE_ITEMS, 'plants water notes coffee', 3);
    expect(results).toHaveLength(3);
    const scores = results.map((entry) => entry.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('breaks score ties deterministically', () => {
    // Same corpus, same query, same order every time — otherwise results flicker between calls.
    const once = retrieve(SITE_ITEMS, 'plants').map((entry) => entry.item['@id']);
    const twice = retrieve(SITE_ITEMS, 'plants').map((entry) => entry.item['@id']);
    expect(once).toEqual(twice);
  });

  it('orders genuinely tied scores by id rather than by input order', () => {
    // Two items identical in every scored field: the only thing separating them is the id
    // tie-break. Without it, ordering would depend on corpus order and look arbitrary.
    const tied: SchemaOrgItem[] = [
      { '@type': 'Article', '@id': 'urn:zebra', name: 'Rain', description: 'Rain', text: 'Rain', url: '/z' },
      { '@type': 'Article', '@id': 'urn:apple', name: 'Rain', description: 'Rain', text: 'Rain', url: '/a' },
    ];
    const results = retrieve(tied, 'rain');
    expect(results.map((entry) => entry.item['@id'])).toEqual(['urn:apple', 'urn:zebra']);
    expect(results[0]?.score).toBe(results[1]?.score);
  });

  it('scores an item that declares no keywords', () => {
    // `keywords` is optional in the Schema.org shape; a product generating items from a database
    // will routinely omit it, so the absent case has to score rather than throw.
    const withoutKeywords: SchemaOrgItem[] = [
      {
        '@type': 'WebPage',
        '@id': 'urn:bare',
        name: 'Composting basics',
        description: 'Turning kitchen scraps into soil.',
        text: 'Composting basics. Kitchen scraps, leaves, and time.',
        url: '/composting',
      },
    ];
    const results = retrieve(withoutKeywords, 'composting');
    expect(results).toHaveLength(1);
    expect(results[0]?.item['@id']).toBe('urn:bare');
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it('weights a title match above a body-text mention', () => {
    // "Notes" is the title of one item and appears in the body of others.
    expect(retrieve(SITE_ITEMS, 'notes')[0]?.item['@id']).toBe('urn:notes');
  });
});

describe('ask', () => {
  it('returns a Schema.org SearchResultsPage without leaking index text', async () => {
    const response = await ask(SITE_ITEMS, 'watering the window plants');
    expect(response['@context']).toBe('https://schema.org');
    expect(response['@type']).toBe('SearchResultsPage');
    expect(response.noMatch).toBe(false);
    expect(response.results[0]).toMatchObject({ '@type': 'FAQPage', name: expect.any(String) });
    // `text` is retrieval fodder, not part of the answer.
    expect(response.results[0]).not.toHaveProperty('text');
  });

  it('flags no-match instead of returning an empty list silently', async () => {
    const response = await ask(SITE_ITEMS, 'quarterly revenue forecast');
    expect(response.results).toEqual([]);
    expect(response.noMatch).toBe(true);
  });

  it('rejects a blank question as a caller error', async () => {
    await expect(ask(SITE_ITEMS, '   ')).rejects.toThrow(/question is required/);
  });

  it('omits summary entirely when no summarizer is supplied', async () => {
    expect(await ask(SITE_ITEMS, 'plants')).not.toHaveProperty('summary');
  });

  it('summarizes only what retrieval returned, never the whole corpus', async () => {
    const summarize = vi.fn(async () => 'Once a week, on Sundays.');
    const response = await ask(SITE_ITEMS, 'how often do I water the plants', {
      limit: 2,
      summarize,
    });

    expect(response.summary).toBe('Once a week, on Sundays.');
    const [, itemsGiven] = summarize.mock.calls[0] as unknown as [string, unknown[]];
    expect(itemsGiven).toHaveLength(2);
    // Handing the model everything would make the answer independent of retrieval quality,
    // which hides the exact thing this spike exists to measure.
    expect(itemsGiven.length).toBeLessThan(SITE_ITEMS.length);
  });

  it('does not call the summarizer when nothing matched', async () => {
    const summarize = vi.fn(async () => 'should not run');
    const response = await ask(SITE_ITEMS, 'quarterly revenue forecast', { summarize });
    expect(summarize).not.toHaveBeenCalled();
    expect(response.noMatch).toBe(true);
  });
});
