import { describe, expect, it } from 'vitest';
import { createSanitizedLineStream } from '../sanitized-line-stream.js';

describe('sanitized stdout lines', () => {
  it('withholds partial lines and sanitizes before either parsed or raw delivery', () => {
    const seen: string[] = [];
    const stream = createSanitizedLineStream({ maxBytes: 100, emit: ({ text }) => seen.push(text),
      sanitize: ({ fullText }) => fullText.replace('private-token', '[redacted]'), onOverflow: () => {} });
    stream.feed({ chunk: 'first private-' });
    expect(seen).toEqual([]);
    stream.feed({ chunk: 'token\nsecond\nlast' });
    expect(seen).toEqual(['first [redacted]\n', 'second\n']);
    stream.flush({}); stream.flush({});
    expect(seen).toEqual(['first [redacted]\n', 'second\n', 'last']);
  });

  it('drops an oversized line, reports it once, then resumes on the next line', () => {
    const seen: string[] = []; const dropped: number[] = [];
    const stream = createSanitizedLineStream({ maxBytes: 4, emit: ({ text }) => seen.push(text),
      sanitize: ({ fullText }) => fullText, onOverflow: ({ bytes }) => dropped.push(bytes) });
    stream.feed({ chunk: 'éé' }); stream.feed({ chunk: 'secret\nok\n' }); stream.flush({});
    expect(seen).toEqual(['ok\n']); expect(dropped).toEqual([10]);
  });
});
