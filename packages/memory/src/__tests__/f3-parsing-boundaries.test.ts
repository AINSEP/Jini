/**
 * Stryker L5 (2026-10-25) parsing gaps in memory: frontmatter regex anchors / CRLF / padding and
 * the per-field trim, rendering's single-line sanitizing, the `/vN` detection in
 * appendVersionedApiPath, and code-fence stripping in parseStrictJson. Inline expected values.
 */
import { describe, expect, it } from 'vitest';
import { parseEntryFrontmatter, renderEntryFrontmatter } from '../entry-frontmatter.js';
import { appendVersionedApiPath, parseStrictJson } from '../llm-provider.js';

const EMPTY = { name: '', description: '', type: '' };

describe('parseEntryFrontmatter', () => {
  it.each([
    ['LF', '---\nname: A\ndescription: B\ntype: user\n---\nbody', { name: 'A', description: 'B', type: 'user' }, 'body'],
    ['CRLF', '---\r\nname: A\r\ndescription: B\r\ntype: user\r\n---\r\nbody', { name: 'A', description: 'B', type: 'user' }, 'body'],
    ['padded values are trimmed', '---\nname:   A  \ndescription:\tB \ntype:  user \n---\nbody', { name: 'A', description: 'B', type: 'user' }, 'body'],
    ['no newline after the closing fence', '---\nname: A\n---body', { name: 'A', description: '', type: '' }, 'body'],
    ['unknown keys and indented keys ignored', '---\nname: A\n  type: x\ntitle: T\nxname: Z\n---\n', { name: 'A', description: '', type: '' }, ''],
    ['value containing a colon', '---\ndescription: a: b\n---\n', { name: '', description: 'a: b', type: '' }, ''],
  ])('%s', (_label, raw, data, body) => {
    expect(parseEntryFrontmatter({ raw })).toEqual({ data, body });
  });

  it.each([
    ['leading junk before the fence', 'x---\nname: A\n---\nbody'],
    ['no closing fence', '---\nname: A\nbody'],
    ['empty input', ''],
  ])('%s → empty fields and the raw text as body', (_label, raw) => {
    expect(parseEntryFrontmatter({ raw })).toEqual({ data: EMPTY, body: raw });
  });

  it('render → parse round-trips, collapsing newlines in fields and leading body whitespace', () => {
    const raw = renderEntryFrontmatter({ fields: { name: ' A\nB ', description: 'x\r\ny', type: ' user ' }, body: '\n\n  hello\n' });
    expect(raw).toBe('---\nname: A B\ndescription: x y\ntype: user\n---\n\nhello\n\n');
    expect(parseEntryFrontmatter({ raw })).toEqual({ data: { name: 'A B', description: 'x y', type: 'user' }, body: '\nhello\n\n' });
  });
});

describe('appendVersionedApiPath', () => {
  it.each([
    ['https://api.x.com', 'https://api.x.com/v1/messages'],
    ['https://api.x.com/', 'https://api.x.com/v1/messages'],
    ['https://api.x.com/v1', 'https://api.x.com/v1/messages'],
    ['https://api.x.com/v1/', 'https://api.x.com/v1/messages'],
    ['https://api.x.com/v2', 'https://api.x.com/v2/messages'],
    ['https://api.x.com/proxy/v10/', 'https://api.x.com/proxy/v10/messages'],
    ['https://api.x.com/v1beta', 'https://api.x.com/v1beta/v1/messages'],
    ['https://api.x.com/apiv1', 'https://api.x.com/apiv1/v1/messages'],
    ['https://api.x.com/v', 'https://api.x.com/v/v1/messages'],
  ])('%s', (baseUrl, expected) => {
    expect(appendVersionedApiPath({ baseUrl, suffix: '/messages' })).toBe(expected);
  });
});

describe('parseStrictJson', () => {
  it.each([
    ['plain', '{"a":1}'],
    ['json fence', '```json\n{"a":1}\n```'],
    ['JSON fence uppercase', '```JSON\n{"a":1}\n```'],
    ['bare fence', '```\n{"a":1}\n```'],
    ['fence with trailing spaces', '  ```json {"a":1} ```  '],
    ['prose around an object', 'Here you go: {"a":1} thanks'],
  ])('%s', (_label, rawText) => {
    expect(parseStrictJson({ rawText })).toEqual({ a: 1 });
  });

  it('only strips a fence that opens the text', () => {
    expect(parseStrictJson({ rawText: '[1,2]' })).toEqual([1, 2]);
    expect(() => parseStrictJson({ rawText: 'x ```json\n[1]\n```' })).toThrow('llm-provider: response was not valid JSON');
  });

  it.each(['', 'not json', '{bad', '```json\n```'])('refuses %j with the specific error', (rawText) => {
    expect(() => parseStrictJson({ rawText })).toThrow('llm-provider: response was not valid JSON');
  });
});
