import { describe, expect, it } from 'vitest';
import { parseSseFrame } from '../sse.js';

describe('parseSseFrame', () => {
  it('parses a named event with a JSON data payload and id', () => {
    const result = parseSseFrame({ frame: 'event: tick\nid: 42\ndata: {"n":1}' });
    expect(result).toEqual({ kind: 'event', event: 'tick', data: { n: 1 }, id: '42' });
  });

  it('defaults the event name to "message" when omitted', () => {
    const result = parseSseFrame({ frame: 'data: {"ok":true}' });
    expect(result).toEqual({ kind: 'event', event: 'message', data: { ok: true } });
  });

  it('joins multiple data: lines before parsing JSON', () => {
    const result = parseSseFrame({ frame: 'data: {"a":1,\ndata: "b":2}' });
    expect(result).toEqual({ kind: 'event', event: 'message', data: { a: 1, b: 2 } });
  });

  it('returns a comment frame for data-less lines prefixed with ":"', () => {
    const result = parseSseFrame({ frame: ': keep-alive' });
    expect(result).toEqual({ kind: 'comment', comment: 'keep-alive' });
  });

  it('returns empty for a frame with neither data nor comment lines', () => {
    expect(parseSseFrame({ frame: 'event: noop' })).toEqual({ kind: 'empty' });
  });

  it('returns null when data: lines do not parse as JSON', () => {
    expect(parseSseFrame({ frame: 'data: not-json' })).toBeNull();
  });

  it('strips trailing \\r from CRLF-terminated lines', () => {
    const result = parseSseFrame({ frame: 'event: tick\r\ndata: {"n":1}\r' });
    expect(result).toEqual({ kind: 'event', event: 'tick', data: { n: 1 } });
  });

  it('prefers the data payload over comment lines in the same frame', () => {
    const result = parseSseFrame({ frame: ': note\ndata: {"n":2}' });
    expect(result).toEqual({ kind: 'event', event: 'message', data: { n: 2 } });
  });

  it('joins several comment lines with a newline and trims the space after ":"', () => {
    expect(parseSseFrame({ frame: ':first\n:   second' })).toEqual({ kind: 'comment', comment: 'first\nsecond' });
  });

  it('omits the id when the id: line carries only whitespace', () => {
    const result = parseSseFrame({ frame: 'id:   \ndata: {"n":3}' });
    expect(result).toEqual({ kind: 'event', event: 'message', data: { n: 3 } });
  });

  it('ignores field lines without the space after the colon', () => {
    expect(parseSseFrame({ frame: 'data:{"n":4}\nevent:tick' })).toEqual({ kind: 'empty' });
  });

  it('keeps the last event: and id: line when they repeat', () => {
    const result = parseSseFrame({ frame: 'event: a\nevent:  b \nid: 1\nid: 2\ndata: {}' });
    expect(result).toEqual({ kind: 'event', event: 'b', data: {}, id: '2' });
  });
});
