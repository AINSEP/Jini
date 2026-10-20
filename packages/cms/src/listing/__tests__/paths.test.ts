import { describe, expect, it } from 'vitest';
import { LISTING_AFTER_MAX } from '../batch.js';
import { LISTING_KEY_MAX, listingBatchPath, parseListingBatchPath } from '../paths.js';

describe('listingBatchPath', () => {
  it('strips every trailing slash from the page path', () => {
    expect(listingBatchPath({ pagePath: '/blog//', key: 1, after: 0 })).toBe('/blog/_more/1/0');
  });
});

describe('parseListingBatchPath bounds', () => {
  it('accepts the highest key and cursor', () => {
    expect(parseListingBatchPath({ path: `/_more/${LISTING_KEY_MAX}/${LISTING_AFTER_MAX}` })).toEqual({ pagePath: '/', key: LISTING_KEY_MAX, after: LISTING_AFTER_MAX });
  });

  it('refuses a key one past LISTING_KEY_MAX', () => {
    expect(parseListingBatchPath({ path: `/_more/${LISTING_KEY_MAX + 1}/0` })).toBeUndefined();
  });

  it('refuses a cursor one past LISTING_AFTER_MAX', () => {
    expect(parseListingBatchPath({ path: `/_more/1/${LISTING_AFTER_MAX + 1}` })).toBeUndefined();
  });

  it('normalizes a zero-padded cursor instead of refusing it, so two URLs name one batch (reported, not fixed)', () => {
    expect(parseListingBatchPath({ path: '/blog/_more/1/012' })).toEqual({ pagePath: '/blog', key: 1, after: 12 });
  });
});

describe('parseListingBatchPath page segments', () => {
  it('refuses a single-dot segment', () => {
    expect(parseListingBatchPath({ path: '/./_more/1/0' })).toBeUndefined();
  });

  it('refuses a _more segment inside the page path', () => {
    expect(parseListingBatchPath({ path: '/_more/_more/1/0' })).toBeUndefined();
  });

  it('refuses a reserved page that is the first segment on its own', () => {
    expect(parseListingBatchPath({ path: '/api/_more/1/0' })).toBeUndefined();
  });

  it('accepts a reserved word below the first segment', () => {
    expect(parseListingBatchPath({ path: '/blog/admin/_more/1/0' })).toEqual({ pagePath: '/blog/admin', key: 1, after: 0 });
  });

  it('accepts a first segment that only starts with a reserved word', () => {
    expect(parseListingBatchPath({ path: '/apis/_more/1/0' })).toEqual({ pagePath: '/apis', key: 1, after: 0 });
  });

  it('accepts dots inside a segment', () => {
    expect(parseListingBatchPath({ path: '/v1.2/_more/1/0.json' })).toEqual({ pagePath: '/v1.2', key: 1, after: 0, format: 'json' });
  });
});
