import { describe, expect, it } from 'vitest';
import { createDelegatedResultCorrelation } from '../delegated-result-correlation.js';
import { createNodeCredentialCrypto } from '../run-credentials.js';
import { createToolResultDiagnosticProjection, projectDiagnosticFrame } from '../tool-result-diagnostics.js';

describe('correlation proof boundaries', () => {
  it.each([
    { maxRuns: 0 }, { maxRuns: 1.5 }, { maxRuns: Infinity },
    { maxCallsPerRun: 0 }, { maxCallsPerRun: NaN }, { maxCallsPerRun: -1 },
  ])('rejects invalid retention limits %j', options => {
    expect(() => createDelegatedResultCorrelation({ crypto: createNodeCredentialCrypto({}) }, options))
      .toThrow('correlation limits must be positive integers');
  });

  it.each([null, 'pixels', {}, { type: 'url', data: 'PIXELS', media_type: 'image/png' },
    { type: 'base64', data: 1, media_type: 'image/png' }, { type: 'base64', data: 'PIXELS' },
  ])('does not treat incomplete or non-base64 sources as equivalent image bytes: %j', source => {
    const store = createDelegatedResultCorrelation({ crypto: createNodeCredentialCrypto({}) });
    const identity = { runId: 'r', toolUseId: 'call', isError: false };
    const flat = [{ type: 'image', mimeType: 'image/png', data: 'PIXELS' }];
    store.record({ ...identity, content: flat });
    expect(store.matches({ ...identity, content: [{ type: 'image', source }] })).toBe(false);
    store.record({ ...identity, content: [{ type: 'image', source }] });
    expect(store.matches({ ...identity, content: [{ type: 'image', source }] })).toBe(true);
    expect(store.matches({ ...identity, content: flat })).toBe(false);
  });

  it('fails closed when hashing a later echo fails, without losing its original proof', () => {
    const crypto = createNodeCredentialCrypto({});
    let unavailable = false;
    const store = createDelegatedResultCorrelation({ crypto: {
      digest: input => { if (unavailable) throw new Error('unavailable'); return crypto.digest(input); },
    } });
    const result = { runId: 'run', toolUseId: 'call', content: [{ type: 'text', text: 'saved' }], isError: false };
    store.record(result);
    unavailable = true;
    expect(store.matches(result)).toBe(false);
    store.record({ ...result, content: [] });
    unavailable = false;
    expect(store.matches(result)).toBe(true);
  });
});

describe('diagnostic framing boundaries', () => {
  it.each([0, -1, NaN, Infinity, 1.5])('rejects an invalid frame bound %j', maxFrameChars => {
    expect(() => createToolResultDiagnosticProjection({}, { maxFrameChars }))
      .toThrow('diagnostic frame limit must be a positive integer');
  });

  it('bounds standalone frames and flushes a dropped tail only once', () => {
    expect(projectDiagnosticFrame({ line: 'oversized' }, { maxFrameChars: 8 }))
      .toBe('[diagnostic frame exceeded image projection limit]');
    const projection = createToolResultDiagnosticProjection({}, { maxFrameChars: 8 });
    expect(projection.feed({ chunk: '12345678' })).toBe('');
    expect(projection.feed({ chunk: '9more' })).toBe('');
    expect(projection.flush({})).toBe('[diagnostic frame exceeded image projection limit]');
    expect(projection.flush({})).toBe('');
    expect(projection.feed({ chunk: '\n12345678\n' })).toBe('\n12345678\n');
  });

  it.each([null, 'url', {}, { type: 'url', data: 'unchanged', media_type: 'image/png' },
    { type: 'base64', data: 3, media_type: 'image/png' }, { type: 'base64', data: 'unchanged' },
  ])('preserves unrecognized image sources rather than inventing a summary: %j', source => {
    const frame = { content: [{ type: 'image', source }] };
    expect(JSON.parse(projectDiagnosticFrame({ line: JSON.stringify(frame) }))).toEqual(frame);
  });
});
