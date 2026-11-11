import { describe, expect, it } from 'vitest';
import { createToolResultDiagnosticProjection, projectDiagnosticFrame } from '../tool-result-diagnostics.js';

// F1 fix wave (Stryker L8 §3/§4 tool-result-diagnostics.ts 63 %: the image guards mirror
// delegated-result-correlation's). Recognized images are summarized; every malformed shape is
// left byte-identical (never partially redacted, never thrown).
const project = (value: unknown) => projectDiagnosticFrame({ line: JSON.stringify(value) });

describe('projectDiagnosticFrame — F1 image recognition', () => {
  it('summarizes a {mimeType,data} image', () => {
    expect(JSON.parse(project({ type: 'image', mimeType: 'image/png', data: 'AAAA' }))).toEqual({ type: 'image', mimeType: 'image/png', data: '[image image/png; 4 base64 characters]' });
  });
  it('summarizes a base64 source image, keeping the other source fields', () => {
    expect(JSON.parse(project({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBBBBB' } }))).toEqual({
      type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '[image image/jpeg; 6 base64 characters]' },
    });
  });
  it.each([
    ['non-image type', { type: 'text', mimeType: 'image/png', data: 'AAAA' }],
    ['numeric data, no source', { type: 'image', mimeType: 'image/png', data: 7 }],
    ['numeric mimeType, no source', { type: 'image', mimeType: 7, data: 'AAAA' }],
    ['null source', { type: 'image', source: null }],
    ['string source', { type: 'image', source: 'AAAA' }],
    ['url source', { type: 'image', source: { type: 'url', media_type: 'image/png', data: 'AAAA' } }],
    ['numeric source data', { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 1 } }],
    ['numeric source media_type', { type: 'image', source: { type: 'base64', media_type: 1, data: 'AAAA' } }],
  ])('%s is left unchanged', (_l, value) => {
    expect(JSON.parse(project(value))).toEqual(value);
  });
  it('recurses into nested arrays and JSON-encoded `content` strings', () => {
    const inner = JSON.stringify([{ type: 'image', mimeType: 'image/png', data: 'AA' }]);
    expect(JSON.parse(project({ message: { content: inner }, list: [{ type: 'image', mimeType: 'image/gif', data: 'A' }] }))).toEqual({
      message: { content: JSON.stringify([{ type: 'image', mimeType: 'image/png', data: '[image image/png; 2 base64 characters]' }]) },
      list: [{ type: 'image', mimeType: 'image/gif', data: '[image image/gif; 1 base64 characters]' }],
    });
  });
  it('non-JSON lines pass through byte-identical; a line over the limit is replaced by the notice', () => {
    expect(projectDiagnosticFrame({ line: 'plain text {' })).toBe('plain text {');
    expect(projectDiagnosticFrame({ line: '12345' }, { maxFrameChars: 5 })).toBe('12345');
    expect(projectDiagnosticFrame({ line: '123456' }, { maxFrameChars: 5 })).toBe('[diagnostic frame exceeded image projection limit]');
  });
});

describe('createToolResultDiagnosticProjection — F1 framing', () => {
  it.each([[0], [1.5], [Number.NaN], [-3]])('refuses maxFrameChars=%s', (maxFrameChars) => {
    expect(() => createToolResultDiagnosticProjection({}, { maxFrameChars })).toThrow(new Error('diagnostic frame limit must be a positive integer'));
  });
  it('joins a frame split across chunks, emits each completed line with its newline, flushes the tail', () => {
    const p = createToolResultDiagnosticProjection({});
    expect(p.feed({ chunk: '{"type":"image","mimeType":"image/png",' })).toBe('');
    expect(p.feed({ chunk: '"data":"AAAA"}\nnext' })).toBe('{"type":"image","mimeType":"image/png","data":"[image image/png; 4 base64 characters]"}\n');
    expect(p.flush({})).toBe('next');
    expect(p.flush({})).toBe('');
  });
  it('a frame of exactly the limit passes; limit+1 across chunks is dropped through its newline, then framing resumes', () => {
    const p = createToolResultDiagnosticProjection({}, { maxFrameChars: 4 });
    expect(p.feed({ chunk: 'abcd\n' })).toBe('abcd\n');
    expect(p.feed({ chunk: 'abc' })).toBe('');
    expect(p.feed({ chunk: 'de' })).toBe('');
    expect(p.feed({ chunk: 'fg\nok\n' })).toBe('[diagnostic frame exceeded image projection limit]\nok\n');
  });
  it('flush while dropping reports the notice once', () => {
    const p = createToolResultDiagnosticProjection({}, { maxFrameChars: 2 });
    p.feed({ chunk: 'abc' });
    expect(p.flush({})).toBe('[diagnostic frame exceeded image projection limit]');
    expect(p.flush({})).toBe('');
  });
  it('an empty line is still a completed (empty) frame', () => {
    expect(createToolResultDiagnosticProjection({}).feed({ chunk: '\n\n' })).toBe('\n\n');
  });
});

describe('projectDiagnosticFrame — F1 re-score kills', () => {
  it('a null-source image does not abort projection of a sibling valid image in the same frame', () => {
    const frame = { blocks: [{ type: 'image', source: null }, { type: 'image', mimeType: 'image/png', data: 'AAA' }] };
    expect(JSON.parse(project(frame))).toEqual({ blocks: [{ type: 'image', source: null }, { type: 'image', mimeType: 'image/png', data: '[image image/png; 3 base64 characters]' }] });
  });
  it('a JSON-looking string under a key other than `content` is left verbatim', () => {
    const inner = JSON.stringify({ type: 'image', mimeType: 'image/png', data: 'AA' });
    expect(JSON.parse(project({ text: inner }))).toEqual({ text: inner });
  });
  it('maxFrameChars=1 is a valid limit', () => {
    expect(createToolResultDiagnosticProjection({}, { maxFrameChars: 1 }).feed({ chunk: 'a\n' })).toBe('a\n');
  });
});
