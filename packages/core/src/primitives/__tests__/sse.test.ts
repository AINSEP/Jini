import { describe, expect, it } from 'vitest';
import { decodeSseFrames, decodeSseStream, parseSseRecord, type DecodedSseFrame } from '../sse.js';

/** An async source over fixed chunks that records whether the consumer closed it early. */
function chunkSource(chunks: ReadonlyArray<string | Uint8Array>): AsyncIterable<string | Uint8Array> & { closed: boolean; pulled: number } {
  const state = {
    closed: false,
    pulled: 0,
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next: async (): Promise<IteratorResult<string | Uint8Array>> => {
          if (index >= chunks.length) return { done: true, value: undefined };
          state.pulled += 1;
          return { done: false, value: chunks[index++]! };
        },
        return: async (): Promise<IteratorResult<string | Uint8Array>> => {
          state.closed = true;
          return { done: true, value: undefined };
        },
      };
    },
  };
  return state;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

const frames = (chunks: ReadonlyArray<string | Uint8Array>, options = {}) => collect(decodeSseFrames({ source: chunkSource(chunks) }, options));

describe('parseSseRecord', () => {
  it('reads event, id and multi-line data, joining data lines with newlines', () => {
    expect(parseSseRecord({ rawFrame: 'event: delta\nid: 7\ndata: {"a":1}\ndata: second' })).toEqual({
      event: 'delta', id: '7', data: '{"a":1}\nsecond', dataLines: ['{"a":1}', 'second'],
    });
  });

  it('strips exactly one leading space and a trailing CR from each line', () => {
    expect(parseSseRecord({ rawFrame: 'data:  two spaces\r\ndata:none\r' })).toEqual({
      event: null, data: ' two spaces\nnone', dataLines: [' two spaces', 'none'],
    });
  });

  it('ignores comments, retry and unknown fields, and reads a colon-less field name as an empty value', () => {
    expect(parseSseRecord({ rawFrame: ': keep-alive\nretry: 3000\nfoo: bar\ndata\nevent' })).toEqual({
      event: '', data: '', dataLines: [''],
    });
  });

  it('keeps an explicit empty id distinct from an absent one', () => {
    expect(parseSseRecord({ rawFrame: 'id:' })).toEqual({ event: null, id: '', data: '', dataLines: [] });
    expect('id' in parseSseRecord({ rawFrame: 'data: x' })).toBe(false);
  });
});

describe('decodeSseFrames', () => {
  it('frames records across arbitrary string chunk boundaries and does not carry fields between records', async () => {
    expect(await frames(['event: a\nda', 'ta: 1\nid: 9\n', '\ndata: 2\n\n'])).toEqual([
      { event: 'a', id: '9', data: '1', dataLines: ['1'] },
      { event: null, data: '2', dataLines: ['2'] },
    ]);
  });

  it('decodes UTF-8 bytes split mid-character and CRLF split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: héllo €\r\n\r\n');
    const euro = bytes.indexOf(0xe2);
    const parts = [bytes.slice(0, 8), bytes.slice(8, euro + 1), bytes.slice(euro + 1, bytes.length - 2), bytes.slice(bytes.length - 2)];
    expect(await frames(parts)).toEqual([{ event: null, data: 'héllo €', dataLines: ['héllo €'] }]);
  });

  it('skips blank and comment-only records but yields an id-only record', async () => {
    expect(await frames([': ping\n\n\n\nid: 4\n\n'])).toEqual([{ event: null, id: '4', data: '', dataLines: [] }]);
  });

  it('flushes an unterminated tail line and a parsed-but-unterminated record at EOF by default', async () => {
    expect(await frames(['data: one\n\nevent: last\ndata: tail'])).toEqual([
      { event: null, data: 'one', dataLines: ['one'] },
      { event: 'last', data: 'tail', dataLines: ['tail'] },
    ]);
    expect(await frames(['event: done\n'])).toEqual([{ event: 'done', data: '', dataLines: [] }]);
  });

  it('yields nothing extra at EOF when the stream ended on a record boundary', async () => {
    expect(await frames(['data: one\n\n'])).toHaveLength(1);
    expect(await frames([])).toEqual([]);
  });

  it('drops an unterminated record when flushFinalFrame is false', async () => {
    expect(await frames(['data: one\n\ndata: partial\n'], { flushFinalFrame: false })).toEqual([
      { event: null, data: 'one', dataLines: ['one'] },
    ]);
  });

  it('throws RangeError once pending record text exceeds maxBufferChars, counting comments too', async () => {
    await expect(frames([': ' + 'x'.repeat(20) + '\n', 'data: y\n'], { maxBufferChars: 16 })).rejects.toThrow(
      new RangeError('SSE stream exceeded the 16-character unterminated-frame buffer limit'),
    );
    await expect(frames(['data: 0123456789abcdef'], { maxBufferChars: 8 })).rejects.toBeInstanceOf(RangeError);
  });

  it('resets the bound after each completed record so a long stream of small records is accepted', async () => {
    const chunks = Array.from({ length: 5 }, (_, i) => `data: ${i}\n\n`);
    expect((await frames(chunks, { maxBufferChars: 10 })).map((f: DecodedSseFrame) => f.data)).toEqual(['0', '1', '2', '3', '4']);
  });

  it('closes the source iterator when the consumer stops early', async () => {
    const source = chunkSource(['data: 1\n\n', 'data: 2\n\n', 'data: 3\n\n']);
    for await (const frame of decodeSseFrames({ source })) {
      expect(frame.data).toBe('1');
      break;
    }
    expect(source.closed).toBe(true);
    expect(source.pulled).toBe(1);
  });
});

describe('decodeSseStream', () => {
  it('publishes only event/data, dropping id metadata and id-only records', async () => {
    const source = chunkSource(['id: 1\n\nevent: message_start\nid: 2\ndata: {}\n\ndata: [DONE]']);
    expect(await collect(decodeSseStream({ source }))).toEqual([
      { event: 'message_start', data: '{}' },
      { event: null, data: '[DONE]' },
    ]);
  });
});
