import { describe, expect, it } from 'vitest';
import { describeRequestFailure, type RequestFailureVocabulary } from './user-facing-error.js';

const vocabulary: RequestFailureVocabulary = {
  nouns: { pages: { singular: 'page', plural: 'pages' }, posts: { singular: 'post', plural: 'posts' }, media: { singular: 'media item', plural: 'media' } },
  operations: { 'restore/execute': { message: 'The restore result could not be confirmed.', action: 'Check recovery status before another restore.', step: 'restore execution' } },
};

describe('describeRequestFailure', () => {
  it('describes reads, saves and uncertain removals from approved nouns', () => {
    expect(describeRequestFailure({ method: 'GET', route: '/pages', vocabulary })).toMatchObject({ message: 'The pages could not be loaded.', action: expect.stringContaining('Try loading them again') });
    expect(describeRequestFailure({ method: 'PATCH', route: '/pages/:id', vocabulary })).toMatchObject({ message: 'The page save could not be completed.', action: expect.stringContaining('Check whether your changes were saved') });
    expect(describeRequestFailure({ method: 'DELETE', route: '/pages/:id', vocabulary })).toMatchObject({ message: 'The page removal could not be confirmed.', action: expect.stringContaining('Check the list before repeating') });
  });
  it('names the nested resource and handles HEAD like GET', () => {
    expect(describeRequestFailure({ method: 'HEAD', route: '/pages/:id/posts', vocabulary }).message).toBe('The posts could not be loaded.');
  });
  it('does not assume POST creates a record and recognizes known action suffixes', () => {
    expect(describeRequestFailure({ method: 'POST', route: '/pages', vocabulary }).message).toBe('The page operation could not be completed.');
    expect(describeRequestFailure({ method: 'POST', route: '/pages/:id/publish', vocabulary }).message).toBe('The page publishing could not be completed.');
  });
  it('uses operation fallback and host overrides for risky semantics', () => {
    expect(describeRequestFailure({ operation: 'routes/media/update', vocabulary }).message).toBe('The media item save could not be completed.');
    expect(describeRequestFailure({ route: '/recovery/restore/execute', vocabulary })).toEqual(vocabulary.operations!['restore/execute']);
  });
  it('never renders arbitrary paths, query values, parameter names or operation text', () => {
    for (const token of ['PRIVATE_CANARY', ':PRIVATE_CANARY', '__proto__', 'constructor']) {
      const result = describeRequestFailure({ method: token, route: `/pages/${token}?access_token=QUERY_CANARY`, operation: token, vocabulary });
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE_CANARY|QUERY_CANARY|__proto__|constructor|access_token/);
      expect(result.message).toBe('The page operation could not be completed.');
    }
    expect(describeRequestFailure({ vocabulary }).message).toBe('The request could not be completed.');
  });
});
