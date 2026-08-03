import { describe, expect, it } from 'vitest';

import { MODEL_VISIBLE_BLOCK_TYPES, splitToolResultSurfaces } from '../tool-result-surfaces.js';

/**
 * These tests are the security boundary for the model/human fork, not incidental coverage.
 *
 * The case that matters most is "unrecognised block type" — a blacklist implementation passes every
 * other test here and still fails that one, by letting an unknown block through into model context.
 * That is precisely the leak this module exists to prevent, and precisely what a future MCP-UI spec
 * revision would produce.
 */
describe('splitToolResultSurfaces', () => {
  it('passes a non-envelope value through by reference, with no surfaces', () => {
    const output = { posts: [{ id: 'p1' }], total: 1 };
    const result = splitToolResultSurfaces(output);
    expect(result.modelOutput).toBe(output);
    expect(result.surfaces).toEqual([]);
  });

  it.each([undefined, null, 'a string', 42, [1, 2, 3]])('passes through non-record output: %s', (output) => {
    const result = splitToolResultSurfaces(output);
    expect(result.modelOutput).toBe(output);
    expect(result.surfaces).toEqual([]);
  });

  it('leaves an all-text envelope untouched, same reference', () => {
    const output = { content: [{ type: 'text', text: 'done' }] };
    const result = splitToolResultSurfaces(output);
    expect(result.modelOutput).toBe(output);
    expect(result.surfaces).toEqual([]);
  });

  it('withholds a UI resource while keeping the text block', () => {
    const uiResource = {
      type: 'resource',
      resource: {
        uri: 'ui://confirm/post-1',
        mimeType: 'text/html;profile=mcp-app',
        text: '<script>var TOKEN = "s3cret-single-use";</script>',
      },
    };
    const output = { content: [{ type: 'text', text: 'A dialog is open.' }, uiResource] };

    const { modelOutput, surfaces } = splitToolResultSurfaces(output);

    expect(modelOutput).toEqual({ content: [{ type: 'text', text: 'A dialog is open.' }] });
    expect(surfaces).toEqual([uiResource]);
    // The whole point: the secret must not survive anywhere in what the model receives.
    expect(JSON.stringify(modelOutput)).not.toContain('s3cret-single-use');
  });

  it('withholds an UNRECOGNISED block type — fail closed, not fail open', () => {
    // A block type that did not exist when this module was written. A blacklist would pass it
    // through to the model; a whitelist must not.
    const future = { type: 'mcp-ui-v2-widget', payload: { token: 'leaked-if-blacklisted' } };
    const output = { content: [{ type: 'text', text: 'ok' }, future] };

    const { modelOutput, surfaces } = splitToolResultSurfaces(output);

    expect(surfaces).toEqual([future]);
    expect(JSON.stringify(modelOutput)).not.toContain('leaked-if-blacklisted');
  });

  it('withholds a block with no `type` at all', () => {
    const output = { content: [{ text: 'no type field' }] };
    const { modelOutput, surfaces } = splitToolResultSurfaces(output);
    expect(surfaces).toEqual([{ text: 'no type field' }]);
    expect(modelOutput).toEqual({ content: [] });
  });

  it('withholds a non-record block, wrapping it so the surface stays inspectable', () => {
    const output = { content: ['a bare string', 7] };
    const { modelOutput, surfaces } = splitToolResultSurfaces(output);
    expect(modelOutput).toEqual({ content: [] });
    expect(surfaces).toEqual([
      { type: 'unknown', value: 'a bare string' },
      { type: 'unknown', value: 7 },
    ]);
  });

  it('preserves sibling envelope fields such as `_meta` when splitting', () => {
    const output = {
      content: [{ type: 'text', text: 'hi' }, { type: 'resource', resource: { uri: 'ui://x' } }],
      _meta: { correlationId: 'c-1' },
    };
    const { modelOutput } = splitToolResultSurfaces(output);
    expect(modelOutput).toMatchObject({ _meta: { correlationId: 'c-1' } });
  });

  it('does not mutate the input', () => {
    const output = { content: [{ type: 'text', text: 'hi' }, { type: 'resource', resource: {} }] };
    splitToolResultSurfaces(output);
    expect(output.content).toHaveLength(2);
  });

  it('keeps `text` as the only model-visible type — widening this list is a deliberate act', () => {
    // Guards the header's rule: if someone adds a type here, this assertion makes them say so.
    expect(MODEL_VISIBLE_BLOCK_TYPES).toEqual(['text']);
  });
});
