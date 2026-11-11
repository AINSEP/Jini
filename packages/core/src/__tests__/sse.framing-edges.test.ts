import { describe, expect, it } from 'vitest';
import { decodeSseFrames, parseSseRecord } from '../primitives/sse.js';

/** L2 §4 sse.ts: comment lines, blank-line dispatch, empty records, EOF flush on/off, CRLF, and the
 *  maxBufferChars boundary (exactly at the limit passes, one over throws). */
async function* chunks(...parts: Array<string | Uint8Array>) { for (const part of parts) yield part; }
const collect = async (source: AsyncIterable<string | Uint8Array>, options = {}) => {
  const out = [];
  for await (const frame of decodeSseFrames({ source }, options)) out.push(frame);
  return out;
};

describe('parseSseRecord', () => {
  it('skips comments, strips one leading space, keeps a second, and treats a bare field as empty', () => {
    expect(parseSseRecord({ rawFrame: ':comment\nevent: e\ndata:  two-spaces\ndata\nid: 1\nretry: 5\r' })).toEqual({ event: 'e', data: ' two-spaces\n', dataLines: [' two-spaces', ''], id: '1' });
  });
  it('a value containing a colon keeps everything after the first colon', () => {
    expect(parseSseRecord({ rawFrame: 'data: a:b:c' }).data).toBe('a:b:c');
  });
  it('an empty explicit id is kept, an absent one is omitted', () => {
    expect(parseSseRecord({ rawFrame: 'id:' })).toEqual({ event: null, data: '', dataLines: [], id: '' });
    expect('id' in parseSseRecord({ rawFrame: 'data: x' })).toBe(false);
  });
});

describe('decodeSseFrames', () => {
  it('dispatches on blank lines (LF and CRLF), skipping comment-only and empty records', async () => {
    const frames = await collect(chunks(': keepalive\n\n', 'data: a\r\n\r\n', '\n\n', 'event: x\ndata: b\n\n'));
    expect(frames.map(f => [f.event, f.data])).toEqual([[null, 'a'], ['x', 'b']]);
  });
  it('an id-only record is dispatched; ids do not carry over to the next record', async () => {
    const frames = await collect(chunks('id: 7\n\ndata: z\n\n'));
    expect(frames).toEqual([{ event: null, data: '', dataLines: [], id: '7' }, { event: null, data: 'z', dataLines: ['z'] }]);
  });
  it('joins split UTF-8 and split CRLF across chunks', async () => {
    const bytes = new TextEncoder().encode('data: é\r\n\r\n');
    const frames = await collect(chunks(bytes.slice(0, 7), bytes.slice(7, 9), bytes.slice(9)));
    expect(frames.map(f => f.data)).toEqual(['é']);
  });
  it('flushes an unterminated tail by default and drops it when flushFinalFrame is false', async () => {
    expect((await collect(chunks('data: a\n\ndata: tail'))).map(f => f.data)).toEqual(['a', 'tail']);
    expect((await collect(chunks('data: a\ndata: b\n'))).map(f => f.data)).toEqual(['a\nb']);
    expect((await collect(chunks('data: a\n\ndata: tail'), { flushFinalFrame: false })).map(f => f.data)).toEqual(['a']);
    expect(await collect(chunks(': only a comment'))).toEqual([]);
  });
  it('maxBufferChars: pending text (terminator included) of exactly the limit passes; one more char throws', async () => {
    const line = 'data: 0123456789\n'; // 17 chars; with its blank-line terminator 18 are pending
    await expect(collect(chunks(line, '\n'), { maxBufferChars: 18 })).resolves.toHaveLength(1);
    await expect(collect(chunks(line, '\n'), { maxBufferChars: 17 })).rejects.toThrow(RangeError);
    await expect(collect(chunks(line, 'x'), { maxBufferChars: 17 })).rejects.toThrow(new RangeError('SSE stream exceeded the 17-character unterminated-frame buffer limit'));
  });
  it('the buffer accounting resets after each dispatched record', async () => {
    const record = 'data: 0123456789\n\n';
    await expect(collect(chunks(record, record, record), { maxBufferChars: 18 })).resolves.toHaveLength(3);
  });
  it('comment and ignored-field text counts toward the limit', async () => {
    await expect(collect(chunks(': aaaaaaaaaa\n', 'retry: 1\n', 'data'), { maxBufferChars: 20 })).rejects.toThrow(RangeError);
  });
});
