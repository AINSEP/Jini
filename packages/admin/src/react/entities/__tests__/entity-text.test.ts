import { describe, expect, it } from 'vitest';
import { entityText, selectTranslate } from '../types.js';

const translate = ({ key }: { readonly key: string }) => `tr:${key}`;

describe('entityText', () => {
  it('fills known placeholders after translating and leaves unknown ones verbatim', () => {
    expect(entityText({ translate, key: '{count} of {total} {unit}', values: { count: 2, total: 'ten' } }))
      .toBe('tr:2 of ten {unit}');
  });
});

describe('selectTranslate', () => {
  it('routes the positional key through the host dictionary', () => {
    expect(selectTranslate({ translate })('No matches')).toBe('tr:No matches');
  });
});
