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
