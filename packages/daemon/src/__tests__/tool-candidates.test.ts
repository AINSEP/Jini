import { describe, expect, it } from 'vitest';
import { toolCandidates } from '../core/tool-candidates.js';

const descriptors = (...ids: string[]) => ids.map(id => ({ id }));

describe('unknown-tool candidate ranking', () => {
  it('puts the registered resource first before applying the eight-item cutoff', () => {
    const tools = descriptors(...Array.from({ length: 10 }, (_, index) => `content_read.type${index}`), 'content_read.theme');
    const input = { resource: 'theme', privateValue: 'never disclose' };
    const result = toolCandidates({ toolId: 'content_read', input, tools });
    expect(result).toEqual(['content_read.theme', ...Array.from({ length: 7 }, (_, index) => `content_read.type${index}`)]);
    expect(input).toEqual({ resource: 'theme', privateValue: 'never disclose' });
    expect(tools.at(-1)).toEqual({ id: 'content_read.theme' });
  });

  it('ranks prefix matches by edit distance, keeping catalog order only for ties', () => {
    expect(toolCandidates({ toolId: 'read', tools: descriptors('read_very_long', 'reader', 'read_x', 'read') })).toEqual([
      'read', 'reader', 'read_x', 'read_very_long',
    ]);
  });

  it('suggests a close misspelling while excluding unrelated and contains-only names', () => {
    expect(toolCandidates({ toolId: 'content_reed.theme', tools: descriptors('site_content_read.theme', 'content_read.page', 'content_read.theme') })).toEqual(['content_read.theme']);
    expect(toolCandidates({ toolId: 'missing', tools: descriptors('unrelated') })).toEqual([]);
  });

  it('ranks a missing resource by similarity without inventing a registration', () => {
    expect(toolCandidates({ toolId: 'content_read', input: { resource: 'them' }, tools: descriptors('content_read.backup_restore_point', 'content_read.theme') })).toEqual([
      'content_read.theme', 'content_read.backup_restore_point',
    ]);
  });

  it.each([undefined, null, [], 'theme', {}, { resource: 3 }, { resource: '' }])('ignores a malformed selector %j', input => {
    const tools = descriptors('content_read.a', 'content_read.theme');
    expect(toolCandidates({ toolId: 'content_read', input, tools })).toEqual(['content_read.a', 'content_read.theme']);
  });

  it('uses resource hints only for the content_read family', () => {
    expect(toolCandidates({ toolId: 'read', input: { resource: 'theme' }, tools: descriptors('read.a', 'read.theme') })).toEqual(['read.a', 'read.theme']);
  });

  it('matches registered resource names without imposing a separate identifier grammar', () => {
    expect(toolCandidates({ toolId: 'content_read', input: { resource: 'plugin.theme' }, tools: descriptors('content_read.a', 'content_read.plugin.theme') })).toEqual([
      'content_read.plugin.theme', 'content_read.a',
    ]);
    const tools = descriptors('content_read.a', 'content_read.theme');
    expect(toolCandidates({ toolId: 'content_read', input: { resource: '../private-input' }, tools }).sort()).toEqual(tools.map(tool => tool.id).sort());
  });

  it('bounds fuzzy scoring while preserving oversized prefixes and exact registered selectors', () => {
    const toolId = 'x'.repeat(129);
    expect(toolCandidates({ toolId, tools: descriptors(`${toolId}a`, `${toolId}b`, 'x') })).toEqual([`${toolId}a`, `${toolId}b`]);
    const resource = 'r'.repeat(129);
    expect(toolCandidates({ toolId: 'content_read', input: { resource }, tools: descriptors('content_read.a', `content_read.${resource}`) })).toEqual([`content_read.${resource}`, 'content_read.a']);
  });
});
