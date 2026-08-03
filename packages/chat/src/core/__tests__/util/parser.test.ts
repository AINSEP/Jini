import { describe, expect, it } from 'vitest';
import { createArtifactParser, parseArtifacts, type ArtifactEvent } from '../../util/index.js';

const HTML_DOC = '<!doctype html><html><head></head><body><h1>Hello there, world</h1></body></html>';

describe('artifacts/parser', () => {
  it('parses a complete artifact block via the one-shot parseArtifacts() convenience wrapper', () => {
    const content = `intro text <artifact identifier="a" type="text/html" title="Demo">${HTML_DOC}</artifact> outro`;
    const events = parseArtifacts(content);
    expect(events[0]).toEqual({ type: 'text', delta: 'intro text ' });
    expect(events[1]).toMatchObject({ type: 'artifact:start', identifier: 'a', artifactType: 'text/html', title: 'Demo' });
    const chunkEvents = events.filter((e): e is Extract<ArtifactEvent, { type: 'artifact:chunk' }> => e.type === 'artifact:chunk');
    expect(chunkEvents.map((e) => e.delta).join('')).toBe(HTML_DOC);
    expect(events.at(-2)).toMatchObject({ type: 'artifact:end', identifier: 'a', fullContent: HTML_DOC });
    expect(events.at(-1)).toEqual({ type: 'text', delta: ' outro' });
  });

  it('reassembles identically whether fed in one chunk or split byte-by-byte across the open tag', () => {
    const content = `<artifact identifier="x" type="text/html" title="T">${HTML_DOC}</artifact>`;
    const whole = parseArtifacts(content);

    const parser = createArtifactParser();
    const streamed: ArtifactEvent[] = [];
    for (const char of content) {
      streamed.push(...parser.feed(char));
    }
    streamed.push(...parser.flush());

    const wholeFull = whole.find((e) => e.type === 'artifact:end');
    const streamedFull = streamed.find((e) => e.type === 'artifact:end');
    expect(streamedFull).toEqual(wholeFull);
  });

  it('does not treat a literal "<artifact ...>" recited inside a fenced code block as a real tag', () => {
    const content = ['Here is the protocol:', '```', '<artifact identifier="demo" type="text/html" title="Demo">...</artifact>', '```', 'end of explanation'].join('\n');
    const events = parseArtifacts(content);
    expect(events.every((e) => e.type === 'text')).toBe(true);
    expect(events.map((e) => (e as { delta: string }).delta).join('')).toBe(content);
  });

  it('holds back an unresolved "<art" prefix at the tail instead of misreading it as plain text', () => {
    const parser = createArtifactParser();
    const first = [...parser.feed('hello <art')];
    // Nothing should flush past the ambiguous prefix yet.
    expect(first).toEqual([{ type: 'text', delta: 'hello ' }]);
    const second = [...parser.feed('ifact identifier="a" type="text/html" title="t">body</artifact>')];
    expect(second[0]).toMatchObject({ type: 'artifact:start', identifier: 'a' });
  });

  it('treats "<artifactual" as a prefix-shared literal, not a real open tag, and keeps scanning past it', () => {
    const content = `no tag here: <artifactual thing then a real one <artifact identifier="a" type="text/html" title="t">${HTML_DOC}</artifact>`;
    const events = parseArtifacts(content);
    expect(events[0]).toMatchObject({ type: 'text' });
    expect((events[0] as { delta: string }).delta).toContain('<artifactual');
    expect(events.some((e) => e.type === 'artifact:start' && e.identifier === 'a')).toBe(true);
  });

  it('holds back an entire buffer that is an unclosed fence containing a look-alike tag, rather than parsing it', () => {
    const parser = createArtifactParser();
    const events = [...parser.feed('```\n<artifact identifier="a" type="text/html" title="t">')];
    expect(events).toEqual([]);
  });

  it('holds back a tail line that could still resolve into a fence opener (e.g. "```ht")', () => {
    const parser = createArtifactParser();
    const events = [...parser.feed('some text\n```ht')];
    expect(events).toEqual([{ type: 'text', delta: 'some text\n' }]);
  });

  it('holds back a tail line that is a lone unmatched backtick or backtick pair', () => {
    const parser = createArtifactParser();
    const events = [...parser.feed('some text\n`')];
    expect(events).toEqual([{ type: 'text', delta: 'some text\n' }]);
  });

  it('holds back an unmatched inline-code backtick and eventually reassembles the full text once it resolves', () => {
    const parser = createArtifactParser();
    const collected: ArtifactEvent[] = [];
    collected.push(...parser.feed('plain text `unterminated'));
    collected.push(...parser.feed(' more`, done.'));
    collected.push(...parser.flush());
    expect(collected.every((e) => e.type === 'text')).toBe(true);
    expect(collected.map((e) => (e as { delta: string }).delta).join('')).toBe('plain text `unterminated more`, done.');
  });

  it('parses single-quoted attribute values the same as double-quoted ones', () => {
    const events = parseArtifacts(`<artifact identifier='a' type='text/html' title='Single Quoted'>${HTML_DOC}</artifact>`);
    expect(events[0]).toMatchObject({ type: 'artifact:start', identifier: 'a', artifactType: 'text/html', title: 'Single Quoted' });
  });

  it('defaults identifier/type/title to empty strings when the open tag has no attributes', () => {
    // "<artifact>" with no space is not a real open tag at all (isRealArtifactOpenAt requires
    // whitespace right after "artifact") — a bare "<artifact >" is the minimal real, attribute-less open.
    const events = parseArtifacts(`<artifact >${HTML_DOC}</artifact>`);
    expect(events[0]).toEqual({ type: 'artifact:start', identifier: '', artifactType: '', title: '' });
  });

  it('flush() emits a trailing chunk plus artifact:end when the stream ends mid-body', () => {
    const parser = createArtifactParser();
    // A body shorter than CLOSE_TAG.length - 1 is held back in full during feed() (nothing is
    // flushed early as a potential partial close-tag match), so flush() alone carries it all.
    [...parser.feed(`<artifact identifier="a" type="text/html" title="t">hi`)];
    const flushed = [...parser.flush()];
    expect(flushed).toEqual([
      { type: 'artifact:chunk', identifier: 'a', delta: 'hi' },
      { type: 'artifact:end', identifier: 'a', fullContent: 'hi' },
    ]);
  });

  it('flush() emits only artifact:end (no empty chunk) when the stream ends exactly at the open tag with no body yet', () => {
    const parser = createArtifactParser();
    [...parser.feed(`<artifact identifier="a" type="text/html" title="t">`)];
    const flushed = [...parser.flush()];
    expect(flushed).toEqual([{ type: 'artifact:end', identifier: 'a', fullContent: '' }]);
  });

  it('flush() emits the held-back buffer as plain text when the stream ends without ever resolving an ambiguous prefix', () => {
    const parser = createArtifactParser();
    [...parser.feed('hello <art')];
    const flushed = [...parser.flush()];
    expect(flushed).toEqual([{ type: 'text', delta: '<art' }]);
  });

  it('flush() is a no-op on a fresh parser with nothing buffered', () => {
    const parser = createArtifactParser();
    expect([...parser.flush()]).toEqual([]);
  });
});
