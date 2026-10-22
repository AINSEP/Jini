import { describe, expect, it } from 'vitest';
import { parseGuideTopics } from '../topic-schema.js';
const card = { id: 'forms', title: 'Forms', summary: 'Native forms', explanation: 'Use definitions.', permissions: ['forms.read'], pointers: [{ label: 'Forms', tool: 'forms_list', permissions: ['forms.read'] }], workflows: [] };
const raw = (topics: unknown[]) => JSON.stringify({ version: 1, topics });
describe('data-only topic admission', () => {
  it('admits the versioned card contract', () => { expect(parseGuideTopics({ raw: raw([card]) })).toEqual({ ok: true, descriptors: [card] }); });
  it('rejects invalid JSON without returning the original bytes', () => { expect(parseGuideTopics({ raw: 'PRIVATE_CANARY' })).toEqual({ ok: false, reason: 'site-guide manifest must be valid JSON' }); });
  it('rejects scripts, unknown fields, missing gates and unsafe pointer URLs', () => {
    for (const invalid of [{ ...card, module: 'evil.mjs' }, { ...card, permissions: undefined }, { ...card, pointers: [{ label: 'Run', href: 'javascript:alert(1)', permissions: [] }] }, { ...card, workflows: [{ title: 'Build', steps: [], permissions: [] }] }]) {
      expect(parseGuideTopics({ raw: raw([invalid]) })).toEqual({ ok: false, reason: 'site-guide manifest does not match version 1 topic schema' });
    }
  });
  it('rejects duplicate ids, too many cards, and oversized files', () => {
    expect(parseGuideTopics({ raw: raw([card, card]) })).toEqual({ ok: false, reason: 'site-guide manifest contains duplicate topic ids' });
    expect(parseGuideTopics({ raw: raw(Array.from({ length: 65 }, (_, i) => ({ ...card, id: `topic-${i}` }))) }).ok).toBe(false);
    expect(parseGuideTopics({ raw: 'x'.repeat(262_145) })).toEqual({ ok: false, reason: 'site-guide manifest exceeds 256 KiB' });
  });
});

describe('topic admission field rules', () => {
  const rejected = { ok: false, reason: 'site-guide manifest does not match version 1 topic schema' };
  it('admits href-only pointers to admin, development and HTTPS documents, and workflows with steps', () => {
    const admitted = {
      ...card,
      pointers: [
        { label: 'Admin', href: '/admin/forms', permissions: [] },
        { label: 'Docs', href: 'development/forms.md', permissions: ['forms.read'] },
        { label: 'Site', href: 'https://example.test/forms', tool: 'forms_open', permissions: [] },
      ],
      workflows: [{ title: 'Publish a form', steps: ['Open the form', 'Press publish'], permissions: ['forms.write'] }],
    };
    expect(parseGuideTopics({ raw: raw([admitted]) })).toEqual({ ok: true, descriptors: [admitted] });
  });

  it.each([
    { name: 'a pointer with an unknown field', topic: { ...card, pointers: [{ label: 'Forms', tool: 'forms_list', permissions: [], script: 'x' }] } },
    { name: 'a pointer with an empty label', topic: { ...card, pointers: [{ label: '', tool: 'forms_list', permissions: [] }] } },
    { name: 'a pointer whose permissions are not a list', topic: { ...card, pointers: [{ label: 'Forms', tool: 'forms_list', permissions: 'forms.read' }] } },
    { name: 'a pointer whose tool name is too long', topic: { ...card, pointers: [{ label: 'Forms', tool: 't'.repeat(129), permissions: [] }] } },
    { name: 'a pointer with neither a tool nor an href', topic: { ...card, pointers: [{ label: 'Forms', permissions: [] }] } },
    { name: 'a pointer to a local file path', topic: { ...card, pointers: [{ label: 'Forms', href: '/etc/passwd', permissions: [] }] } },
    { name: 'a workflow given as a string', topic: { ...card, workflows: ['Build'] } },
    { name: 'a workflow with an unknown field', topic: { ...card, workflows: [{ title: 'Build', steps: ['a'], permissions: [], run: 'x' }] } },
    { name: 'a workflow step that is not text', topic: { ...card, workflows: [{ title: 'Build', steps: [3], permissions: [] }] } },
    { name: 'an id with uppercase letters', topic: { ...card, id: 'Forms' } },
    { name: 'an id longer than 64 characters', topic: { ...card, id: `a${'b'.repeat(64)}` } },
    { name: 'a non-object topic', topic: 'forms' },
  ])('refuses the whole manifest for $name', ({ topic }) => {
    expect(parseGuideTopics({ raw: raw([topic]) })).toEqual(rejected);
  });

  it('refuses an unknown manifest version or extra top-level field', () => {
    expect(parseGuideTopics({ raw: JSON.stringify({ version: 2, topics: [] }) })).toEqual(rejected);
    expect(parseGuideTopics({ raw: JSON.stringify({ version: 1, topics: [], extra: true }) })).toEqual(rejected);
  });

  it('measures the size limit in UTF-8 bytes, not characters', () => {
    expect(parseGuideTopics({ raw: 'é'.repeat(131_073) })).toEqual({ ok: false, reason: 'site-guide manifest exceeds 256 KiB' });
  });
});
