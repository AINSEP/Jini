import { describe, expect, it } from 'vitest';
import { decodeSseStream, decodeSseFrames, parseSseRecord } from '../sse-decode.js';

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

async function collectFrames(chunks: string[], options = {}) {
  const frames = [];
  for await (const frame of decodeSseFrames({ source: stringsOf(...chunks) }, options)) frames.push(frame);
  return frames;
}

describe('browser-safe framing entry', () => {
  it('shares raw field parsing while preserving data whitespace and explicit empty IDs', () => {
    expect(parseSseRecord({ rawFrame: ': keepalive\r\nid:cursor\r\nid:\r\nevent: end\r\ndata:  first \r\ndata:second' }))
      .toEqual({ event: 'end', id: '', data: ' first \nsecond', dataLines: [' first ', 'second'] });
    expect(parseSseRecord({ rawFrame: 'retry: 10\nunknown\n: comment' }))
      .toEqual({ event: null, data: '', dataLines: [] });
  });

  it('reassembles fields split mid-line and CRLF split between CR and LF', async () => {
    expect(await collectFrames(['i', 'd:c1\r', '\neve', 'nt:agent\r', '\nda', 'ta:hello\r', '\n\r', '\n']))
      .toEqual([{ id: 'c1', event: 'agent', data: 'hello', dataLines: ['hello'] }]);
  });

  it('keeps reattachment IDs verbatim and resets metadata between records', async () => {
    expect(await collectFrames(['id: cursor/one==\ndata: a\n\nid: cursor/two==\ndata: b\n\ndata: c\n\nid:\ndata: d\n\n']))
      .toEqual([
        { id: 'cursor/one==', event: null, data: 'a', dataLines: ['a'] },
        { id: 'cursor/two==', event: null, data: 'b', dataLines: ['b'] },
        { event: null, data: 'c', dataLines: ['c'] },
        { id: '', event: null, data: 'd', dataLines: ['d'] },
      ]);
  });

  it.each(['data: truncated', 'data: truncated\n', 'data: truncated\r\n'])('discards an incomplete durable record: %j', async tail => {
    expect(await collectFrames(['data: committed\n\n', tail], { flushFinalFrame: false }))
      .toEqual([{ event: null, data: 'committed', dataLines: ['committed'] }]);
    expect(await collectFrames([tail])).toEqual([{ event: null, data: 'truncated', dataLines: ['truncated'] }]);
  });

  it('does not count a split final CRLF as an extra blank line', async () => {
    expect(await collectFrames(['data: incomplete\r', '\n'], { flushFinalFrame: false })).toEqual([]);
    expect(await collectFrames(['data: complete\r', '\n\r', '\n'], { flushFinalFrame: false }))
      .toEqual([{ event: null, data: 'complete', dataLines: ['complete'] }]);
  });

  it('bounds accumulated complete lines within an unterminated record', async () => {
    await expect(collectFrames(['data: a\n', 'data: b\n'], { maxBufferChars: 15 }))
      .rejects.toThrow('15-character unterminated-frame buffer limit');
    await expect(collectFrames([': comment\n', 'unknown: value\n'], { maxBufferChars: 15 })).rejects.toThrow(RangeError);
    await expect(collectFrames(['1234', '5'], { maxBufferChars: 4 })).rejects.toThrow(RangeError);
  });

  it('accepts the exact cap and resets it after each committed record', async () => {
    expect(await collectFrames(['data: a\n\n', 'data: b\n\n'], { maxBufferChars: 9 }))
      .toEqual([
        { event: null, data: 'a', dataLines: ['a'] },
        { event: null, data: 'b', dataLines: ['b'] },
      ]);
  });

  it('closes its source iterator when a consumer stops at a terminal frame', async () => {
    let closed = false;
    let advanced = false;
    async function* source() {
      try {
        yield 'event: end\ndata: {}\n\n';
        advanced = true;
        yield 'data: late\n\n';
      } finally { closed = true; }
    }
    for await (const frame of decodeSseFrames({ source: source() })) { expect(frame.event).toBe('end'); break; }
    expect(closed).toBe(true);
    expect(advanced).toBe(false);
  });

  it('flushes a partial UTF-8 code point only under the provider EOF policy', async () => {
    async function* source() { yield new TextEncoder().encode('data: '); yield Uint8Array.of(0xc3); }
    const frames = [];
    for await (const frame of decodeSseFrames({ source: source() })) frames.push(frame.data);
    expect(frames).toEqual(['�']);
    const durable = [];
    for await (const frame of decodeSseFrames({ source: source() }, { flushFinalFrame: false })) durable.push(frame);
    expect(durable).toEqual([]);
  });
});

it('keeps metadata-only records out of the provider compatibility stream', async () => {
  expect(await collect(stringsOf('id: c1\n\nretry: 20\n\nid: c2\nevent: ping\n\ndata: answer\n\n')))
    .toEqual([{ event: 'ping', data: '' }, { event: null, data: 'answer' }]);
});
