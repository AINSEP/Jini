import { describe, expect, it } from 'vitest';
import { createArtifactParser, parseArtifacts, type ArtifactEvent } from '../index.js';

const HTML_DOC = '<!doctype html><html><head></head><body><h1>Hello there, world</h1></body></html>';

describe('artifacts/parser', () => {
  it('parses a complete artifact block via the one-shot parseArtifacts() convenience wrapper', () => {
    const content = `intro text <artifact identifier="a" type="text/html" title="Demo">${HTML_DOC}</artifact> outro`;
    const events = parseArtifacts({ content: content });
    expect(events[0]).toEqual({ type: 'text', delta: 'intro text ' });
    expect(events[1]).toMatchObject({ type: 'artifact:start', identifier: 'a', artifactType: 'text/html', title: 'Demo' });
    const chunkEvents = events.filter((e): e is Extract<ArtifactEvent, { type: 'artifact:chunk' }> => e.type === 'artifact:chunk');
    expect(chunkEvents.map((e) => e.delta).join('')).toBe(HTML_DOC);
    expect(events.at(-2)).toMatchObject({ type: 'artifact:end', identifier: 'a', fullContent: HTML_DOC });
    expect(events.at(-1)).toEqual({ type: 'text', delta: ' outro' });
  });

  it('reassembles identically whether fed in one chunk or split byte-by-byte across the open tag', () => {
    const content = `<artifact identifier="x" type="text/html" title="T">${HTML_DOC}</artifact>`;
    const whole = parseArtifacts({ content: content });

    const parser = createArtifactParser({});
    const streamed: ArtifactEvent[] = [];
    for (const char of content) {
      streamed.push(...parser.feed({ delta: char }));
    }
    streamed.push(...parser.flush({}));

    const wholeFull = whole.find((e) => e.type === 'artifact:end');
    const streamedFull = streamed.find((e) => e.type === 'artifact:end');
    expect(streamedFull).toEqual(wholeFull);
  });

  it('does not treat a literal "<artifact ...>" recited inside a fenced code block as a real tag', () => {
    const content = ['Here is the protocol:', '```', '<artifact identifier="demo" type="text/html" title="Demo">...</artifact>', '```', 'end of explanation'].join('\n');
    const events = parseArtifacts({ content: content });
    expect(events.every((e) => e.type === 'text')).toBe(true);
    expect(events.map((e) => (e as { delta: string }).delta).join('')).toBe(content);
  });

  it('holds back an unresolved "<art" prefix at the tail instead of misreading it as plain text', () => {
    const parser = createArtifactParser({});
    const first = [...parser.feed({ delta: 'hello <art' })];
    // Nothing should flush past the ambiguous prefix yet.
    expect(first).toEqual([{ type: 'text', delta: 'hello ' }]);
    const second = [...parser.feed({ delta: 'ifact identifier="a" type="text/html" title="t">body</artifact>' })];
    expect(second[0]).toMatchObject({ type: 'artifact:start', identifier: 'a' });
  });

  it('treats "<artifactual" as a prefix-shared literal, not a real open tag, and keeps scanning past it', () => {
    const content = `no tag here: <artifactual thing then a real one <artifact identifier="a" type="text/html" title="t">${HTML_DOC}</artifact>`;
    const events = parseArtifacts({ content: content });
    expect(events[0]).toMatchObject({ type: 'text' });
    expect((events[0] as { delta: string }).delta).toContain('<artifactual');
    expect(events.some((e) => e.type === 'artifact:start' && e.identifier === 'a')).toBe(true);
  });

  it('holds back an entire buffer that is an unclosed fence containing a look-alike tag, rather than parsing it', () => {
    const parser = createArtifactParser({});
    const events = [...parser.feed({ delta: '```\n<artifact identifier="a" type="text/html" title="t">' })];
    expect(events).toEqual([]);
  });

  it('holds back a tail line that could still resolve into a fence opener (e.g. "```ht")', () => {
    const parser = createArtifactParser({});
    const events = [...parser.feed({ delta: 'some text\n```ht' })];
    expect(events).toEqual([{ type: 'text', delta: 'some text\n' }]);
  });

  it('holds back a tail line that is a lone unmatched backtick or backtick pair', () => {
    const parser = createArtifactParser({});
    const events = [...parser.feed({ delta: 'some text\n`' })];
    expect(events).toEqual([{ type: 'text', delta: 'some text\n' }]);
  });

  it('holds back an unmatched inline-code backtick and eventually reassembles the full text once it resolves', () => {
    const parser = createArtifactParser({});
    const collected: ArtifactEvent[] = [];
    collected.push(...parser.feed({ delta: 'plain text `unterminated' }));
    collected.push(...parser.feed({ delta: ' more`, done.' }));
    collected.push(...parser.flush({}));
    expect(collected.every((e) => e.type === 'text')).toBe(true);
    expect(collected.map((e) => (e as { delta: string }).delta).join('')).toBe('plain text `unterminated more`, done.');
  });

  it('parses single-quoted attribute values the same as double-quoted ones', () => {
    const events = parseArtifacts({ content: `<artifact identifier='a' type='text/html' title='Single Quoted'>${HTML_DOC}</artifact>` });
    expect(events[0]).toMatchObject({ type: 'artifact:start', identifier: 'a', artifactType: 'text/html', title: 'Single Quoted' });
  });

  it('defaults identifier/type/title to empty strings when the open tag has no attributes', () => {
    // "<artifact>" with no space is not a real open tag at all (isRealArtifactOpenAt requires
    // whitespace right after "artifact") — a bare "<artifact >" is the minimal real, attribute-less open.
    const events = parseArtifacts({ content: `<artifact >${HTML_DOC}</artifact>` });
    expect(events[0]).toEqual({ type: 'artifact:start', identifier: '', artifactType: '', title: '' });
  });

  it('flush() emits a trailing chunk plus artifact:end when the stream ends mid-body', () => {
    const parser = createArtifactParser({});
    // A body shorter than CLOSE_TAG.length - 1 is held back in full during feed() (nothing is
    // flushed early as a potential partial close-tag match), so flush() alone carries it all.
    [...parser.feed({ delta: `<artifact identifier="a" type="text/html" title="t">hi` })];
    const flushed = [...parser.flush({})];
    expect(flushed).toEqual([
      { type: 'artifact:chunk', identifier: 'a', delta: 'hi' },
      { type: 'artifact:end', identifier: 'a', fullContent: 'hi' },
    ]);
  });

  it('flush() emits only artifact:end (no empty chunk) when the stream ends exactly at the open tag with no body yet', () => {
    const parser = createArtifactParser({});
    [...parser.feed({ delta: `<artifact identifier="a" type="text/html" title="t">` })];
    const flushed = [...parser.flush({})];
    expect(flushed).toEqual([{ type: 'artifact:end', identifier: 'a', fullContent: '' }]);
  });

  it('flush() emits the held-back buffer as plain text when the stream ends without ever resolving an ambiguous prefix', () => {
    const parser = createArtifactParser({});
    [...parser.feed({ delta: 'hello <art' })];
    const flushed = [...parser.flush({})];
    expect(flushed).toEqual([{ type: 'text', delta: '<art' }]);
  });

  it('flush() is a no-op on a fresh parser with nothing buffered', () => {
    const parser = createArtifactParser({});
    expect([...parser.flush({})]).toEqual([]);
  });

  it('treats a ">" inside a quoted attribute value as part of the value, not the end of the open tag', () => {
    const events = parseArtifacts({ content: '<artifact identifier="a>b" type=\'x>y\' title="t">body</artifact>' });
    expect(events[0]).toEqual({ type: 'artifact:start', identifier: 'a>b', artifactType: 'x>y', title: 't' });
  });

  it('holds back an open tag whose closing ">" has not arrived yet, flushing only the text before it', () => {
    const parser = createArtifactParser({});
    expect([...parser.feed({ delta: 'pre <artifact identifier="a" ti' })]).toEqual([{ type: 'text', delta: 'pre ' }]);
  });

  it('holds back a bare "<artifact" at the very end of the buffer', () => {
    const parser = createArtifactParser({});
    expect([...parser.feed({ delta: 'pre <artifact' })]).toEqual([{ type: 'text', delta: 'pre ' }]);
  });

  it('emits the whole tail line as text once its inline-code backticks are balanced', () => {
    const parser = createArtifactParser({});
    expect([...parser.feed({ delta: 'a `b` c' })]).toEqual([{ type: 'text', delta: 'a `b` c' }]);
  });

  it('holds back from the earliest of several hold-back candidates (unmatched backtick before a "<art" tail)', () => {
    const parser = createArtifactParser({});
    expect([...parser.feed({ delta: 'x `y <art' })]).toEqual([{ type: 'text', delta: 'x ' }]);
  });

  it('does not hold back a "<" that sits inside an inline code span', () => {
    const parser = createArtifactParser({});
    expect([...parser.feed({ delta: 'see `<art`' })]).toEqual([{ type: 'text', delta: 'see `<art`' }]);
  });

  it('flushes a complete text buffer ending in a newline without holding anything back', () => {
    const parser = createArtifactParser({});
    expect([...parser.feed({ delta: 'line one\n' })]).toEqual([{ type: 'text', delta: 'line one\n' }]);
  });

  it('withholds the last CLOSE_TAG.length-1 body bytes while inside an artifact so a split close tag is still detected', () => {
    const parser = createArtifactParser({});
    const events = [...parser.feed({ delta: '<artifact identifier="a">0123456789abc' })];
    expect(events.at(-1)).toEqual({ type: 'artifact:chunk', identifier: 'a', delta: '012' });
  });

  it('emits no chunk while inside an artifact when the body is shorter than a close tag', () => {
    const parser = createArtifactParser({});
    const events = [...parser.feed({ delta: '<artifact identifier="a">short' })];
    expect(events).toEqual([{ type: 'artifact:start', identifier: 'a', artifactType: '', title: '' }]);
  });

  it('parses two consecutive artifacts in one feed and resets per-artifact state between them', () => {
    const events = parseArtifacts({ content: '<artifact identifier="a" type="t1" title="A">x</artifact><artifact identifier="b">y</artifact>' });
    expect(events).toEqual([
      { type: 'artifact:start', identifier: 'a', artifactType: 't1', title: 'A' },
      { type: 'artifact:chunk', identifier: 'a', delta: 'x' },
      { type: 'artifact:end', identifier: 'a', fullContent: 'x' },
      { type: 'artifact:start', identifier: 'b', artifactType: '', title: '' },
      { type: 'artifact:chunk', identifier: 'b', delta: 'y' },
      { type: 'artifact:end', identifier: 'b', fullContent: 'y' },
    ]);
  });

  it('emits artifact:end with no chunk when the close tag immediately follows the open tag', () => {
    const events = parseArtifacts({ content: '<artifact identifier="a"></artifact>' });
    expect(events).toEqual([
      { type: 'artifact:start', identifier: 'a', artifactType: '', title: '' },
      { type: 'artifact:end', identifier: 'a', fullContent: '' },
    ]);
  });

  it('treats an adjacent backtick pair outside any code span as balanced and holds nothing back', () => {
    const parser = createArtifactParser({});
    expect([...parser.feed({ delta: 'x ``y' })]).toEqual([{ type: 'text', delta: 'x ``y' }]);
  });
});
