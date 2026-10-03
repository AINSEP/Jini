import { describe, expect, it } from 'vitest';
import { decodeSseStream } from '../sse-decode.js';

async function collect(source: AsyncIterable<Uint8Array | string>) {
  const out: Array<{ event: string | null; data: string }> = [];
  for await (const frame of decodeSseStream({ source: source })) out.push(frame);
  return out;
}

function stringsOf(...chunks: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

describe('decodeSseStream', () => {
  it('decodes a single event/data record terminated by a blank line', async () => {
    const frames = await collect(stringsOf('event: message_start\ndata: {"a":1}\n\n'));
    expect(frames).toEqual([{ event: 'message_start', data: '{"a":1}' }]);
  });

  it('joins multiple data: lines in one record with a newline', async () => {
    const frames = await collect(stringsOf('data: line1\ndata: line2\n\n'));
    expect(frames).toEqual([{ event: null, data: 'line1\nline2' }]);
  });

  it('decodes multiple events queued in a single chunk', async () => {
    const frames = await collect(stringsOf('data: one\n\ndata: two\n\n'));
    expect(frames).toEqual([
      { event: null, data: 'one' },
      { event: null, data: 'two' },
    ]);
  });

  it('handles CRLF line endings', async () => {
    const frames = await collect(stringsOf('event: ping\r\ndata: {}\r\n\r\n'));
    expect(frames).toEqual([{ event: 'ping', data: '{}' }]);
  });

  it('ignores comment lines (leading colon)', async () => {
    const frames = await collect(stringsOf(': keep-alive\ndata: real\n\n'));
    expect(frames).toEqual([{ event: null, data: 'real' }]);
  });

  it('ignores unrecognized field names such as id/retry', async () => {
    const frames = await collect(stringsOf('id: 5\nretry: 3000\ndata: real\n\n'));
    expect(frames).toEqual([{ event: null, data: 'real' }]);
  });

  it('reassembles a record split across multiple chunk boundaries, including mid-line splits', async () => {
    const frames = await collect(stringsOf('eve', 'nt: message_st', 'art\nda', 'ta: {"x"', ':1}\n\n'));
    expect(frames).toEqual([{ event: 'message_start', data: '{"x":1}' }]);
  });

  it('decodes Uint8Array chunks, including a multi-byte UTF-8 character split across chunk boundaries', async () => {
    const full = Buffer.from('data: café\n\n', 'utf8');
    // Split so the 2-byte UTF-8 encoding of 'é' straddles the chunk boundary.
    const splitAt = full.indexOf(Buffer.from('é', 'utf8')) + 1;
    const source: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        yield new Uint8Array(full.subarray(0, splitAt));
        yield new Uint8Array(full.subarray(splitAt));
      },
    };
    const frames = await collect(source);
    expect(frames).toEqual([{ event: null, data: 'café' }]);
  });

  it('produces no frames for an empty source', async () => {
    const frames = await collect(stringsOf());
    expect(frames).toEqual([]);
  });

  it('strips exactly one leading space after the colon, preserving further spaces', async () => {
    const frames = await collect(stringsOf('data:foo\n\ndata:  two-spaces\n\n'));
    expect(frames).toEqual([
      { event: null, data: 'foo' },
      { event: null, data: ' two-spaces' },
    ]);
  });

  it('flushes a trailing record with no terminating blank line once the source ends', async () => {
    const frames = await collect(stringsOf('data: trailing'));
    expect(frames).toEqual([{ event: null, data: 'trailing' }]);
  });

  it('treats a bare trailing CR (no final LF) as the record-terminating blank line', async () => {
    // After the last `\n` is consumed by drainCompleteLines, the leftover buffer is a lone
    // "\r" — stripped to "", which IS the blank-line record terminator, so `data: last`
    // must still be flushed via the CR-stripped `handleLine` call, not silently dropped.
    const frames = await collect(stringsOf('data: last\n\r'));
    expect(frames).toEqual([{ event: null, data: 'last' }]);
  });

  it('does not emit a blank record when a blank line arrives with no preceding fields', async () => {
    const frames = await collect(stringsOf('\n\ndata: real\n\n'));
    expect(frames).toEqual([{ event: null, data: 'real' }]);
  });

  it('treats a field line with no colon as a field name with an empty value (ignored, since it is not event/data)', async () => {
    const frames = await collect(stringsOf('justfield\ndata: real\n\n'));
    expect(frames).toEqual([{ event: null, data: 'real' }]);
  });

  it('resets event type between records (an event: line does not leak into the next record)', async () => {
    const frames = await collect(stringsOf('event: first\ndata: a\n\ndata: b\n\n'));
    expect(frames).toEqual([
      { event: 'first', data: 'a' },
      { event: null, data: 'b' },
    ]);
  });
});
