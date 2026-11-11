import { describe, expect, it } from 'vitest';
import { parseGuideTopics } from '../topic-schema.js';

/** One clause broken per case (AP3/AP8/AP9): each guard in the native topic schema refuses on its own;
 *  limits are pinned at max and max+1; the size cap counts UTF-8 bytes, not UTF-16 units. */
const pointer = { label: 'Open', href: '/admin/x', permissions: ['p'] };
const workflow = { title: 'Do', steps: ['one'], permissions: [] };
const topic = { id: 'a-1', title: 'T', summary: 'S', explanation: 'E', permissions: [], pointers: [pointer], workflows: [workflow] };
const parse = (topics: unknown[], extra: Record<string, unknown> = {}) => parseGuideTopics({ raw: JSON.stringify({ version: 1, topics, ...extra }) });
const SCHEMA = 'site-guide manifest does not match version 1 topic schema';

describe('parseGuideTopics', () => {
  it('accepts the valid baseline', () => {
    expect(parse([topic])).toEqual({ ok: true, descriptors: [topic] });
  });

  it.each([
    ['topic is null', null], ['topic is an array', [topic]], ['topic is a string', 'a-1'],
    ['unknown topic key', { ...topic, extra: 1 }],
    ['id empty', { ...topic, id: '' }], ['id 65 chars', { ...topic, id: 'a'.repeat(65) }], ['id uppercase', { ...topic, id: 'A-1' }],
    ['id leading digit', { ...topic, id: '1a' }], ['id trailing junk', { ...topic, id: 'a-1\n' }], ['id inner junk', { ...topic, id: 'a_1' }],
    ['title 129 chars', { ...topic, title: 't'.repeat(129) }], ['summary 1001 chars', { ...topic, summary: 's'.repeat(1001) }],
    ['explanation empty', { ...topic, explanation: '' }], ['explanation 8001 chars', { ...topic, explanation: 'e'.repeat(8001) }],
    ['permissions not array', { ...topic, permissions: 'p' }], ['33 permissions', { ...topic, permissions: Array.from({ length: 33 }, (_, i) => `p${i}`) }],
    ['permission 129 chars', { ...topic, permissions: ['p'.repeat(129)] }], ['permission non-string', { ...topic, permissions: [1] }],
    ['25 pointers', { ...topic, pointers: Array.from({ length: 25 }, () => pointer) }], ['17 workflows', { ...topic, workflows: Array.from({ length: 17 }, () => workflow) }],
    ['pointer unknown key', { ...topic, pointers: [{ ...pointer, onclick: 'x' }] }],
    ['pointer without tool or href', { ...topic, pointers: [{ label: 'L', permissions: [] }] }],
    ['pointer javascript href', { ...topic, pointers: [{ ...pointer, href: 'javascript:alert(1)' }] }],
    ['pointer http href', { ...topic, pointers: [{ ...pointer, href: 'http://x.test' }] }],
    ['pointer file href', { ...topic, pointers: [{ ...pointer, href: '/etc/passwd' }] }],
    ['pointer href 513 chars', { ...topic, pointers: [{ ...pointer, href: `/admin/${'x'.repeat(506)}` }] }],
    ['pointer tool 129 chars', { ...topic, pointers: [{ label: 'L', tool: 't'.repeat(129), permissions: [] }] }],
    ['pointer label empty', { ...topic, pointers: [{ ...pointer, label: '' }] }],
    ['pointer permissions missing', { ...topic, pointers: [{ label: 'L', href: '/admin/x' }] }],
    ['workflow unknown key', { ...topic, workflows: [{ ...workflow, x: 1 }] }],
    ['workflow zero steps', { ...topic, workflows: [{ ...workflow, steps: [] }] }],
    ['workflow 17 steps', { ...topic, workflows: [{ ...workflow, steps: Array.from({ length: 17 }, () => 's') }] }],
    ['workflow empty step', { ...topic, workflows: [{ ...workflow, steps: [''] }] }],
    ['workflow title missing', { ...topic, workflows: [{ steps: ['s'], permissions: [] }] }],
  ])('refuses %s', (_label, candidate) => {
    expect(parse([topic, candidate].map((item, index) => (index === 0 ? { ...topic, id: 'base' } : item)))).toEqual({ ok: false, reason: SCHEMA });
  });

  it('accepts every limit exactly at its maximum', () => {
    const maxed = {
      ...topic, id: `a${'b'.repeat(63)}`, title: 't'.repeat(128), summary: 's'.repeat(1000), explanation: 'e'.repeat(8000),
      permissions: Array.from({ length: 32 }, () => 'p'.repeat(128)),
      pointers: [...Array.from({ length: 23 }, () => pointer), { label: 'L', tool: 't'.repeat(128), href: `https://${'x'.repeat(504)}`, permissions: [] }],
      workflows: Array.from({ length: 16 }, () => ({ ...workflow, steps: Array.from({ length: 16 }, () => 's') })),
    };
    expect(parse([maxed]).ok).toBe(true);
    for (const href of ['/admin/a', 'development/b', 'https://c']) expect(parse([{ ...topic, pointers: [{ ...pointer, href }] }]).ok).toBe(true);
  });

  it.each([
    ['version 2', { version: 2, topics: [] }], ['version "1"', { version: '1', topics: [] }], ['extra top-level key', { version: 1, topics: [], x: 1 }],
    ['topics not array', { version: 1, topics: {} }], ['65 topics', { version: 1, topics: Array.from({ length: 65 }, (_, i) => ({ ...topic, id: `t${i}` })) }],
  ])('refuses envelope: %s', (_label, document) => {
    expect(parseGuideTopics({ raw: JSON.stringify(document) })).toEqual({ ok: false, reason: SCHEMA });
  });

  it('refuses null/array documents and invalid JSON with fixed reasons', () => {
    expect(parseGuideTopics({ raw: 'null' })).toEqual({ ok: false, reason: SCHEMA });
    expect(parseGuideTopics({ raw: '[]' })).toEqual({ ok: false, reason: SCHEMA });
    expect(parseGuideTopics({ raw: '{' })).toEqual({ ok: false, reason: 'site-guide manifest must be valid JSON' });
  });

  it('duplicate ids anywhere in the list are refused', () => {
    expect(parse([topic, { ...topic, id: 'b' }, { ...topic }])).toEqual({ ok: false, reason: 'site-guide manifest contains duplicate topic ids' });
  });

  it('size cap: 262144 bytes passes the size check; one more byte (or multibyte overflow) is refused', () => {
    const doc = (pad: string) => JSON.stringify({ version: 1, topics: [] }).replace('[]', `[]${pad}`);
    const base = doc('');
    expect(parseGuideTopics({ raw: base + ' '.repeat(262_144 - base.length) })).toEqual({ ok: true, descriptors: [] });
    expect(parseGuideTopics({ raw: base + ' '.repeat(262_145 - base.length) })).toEqual({ ok: false, reason: 'site-guide manifest exceeds 256 KiB' });
    const multibyte = JSON.stringify({ version: 1, topics: [{ ...topic, explanation: 'é'.repeat(7000) }] });
    const padded = multibyte + ' '.repeat(262_144 - multibyte.length - 7000 + 1);
    expect(padded.length).toBeLessThanOrEqual(262_144);
    expect(parseGuideTopics({ raw: padded })).toEqual({ ok: false, reason: 'site-guide manifest exceeds 256 KiB' });
  });
});
