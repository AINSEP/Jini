import { describe, expect, it } from 'vitest';
import {
  MCP_UI_MIME_TYPE,
  MCP_UI_PREFERRED_FRAME_SIZE_META_KEY,
  MCP_UI_RESOURCE_URI_META_KEY,
  UI_RESOURCE_MIME_TYPES,
  buildUIToolResult,
  createUIResource,
  parseUIResource,
  readPreferredFrameSize,
} from '../resource.js';

describe('createUIResource', () => {
  it('builds an EmbeddedResource with the standardized MCP Apps MIME type', () => {
    const resource = createUIResource({ uri: 'ui://x/1', htmlString: '<p>hi</p>' });
    expect(resource).toEqual({
      type: 'resource',
      resource: { uri: 'ui://x/1', mimeType: 'text/html;profile=mcp-app', text: '<p>hi</p>' },
    });
  });

  it('omits _meta entirely rather than emitting an empty object', () => {
    expect(createUIResource({ uri: 'ui://x/1', htmlString: '' }).resource).not.toHaveProperty('_meta');
  });

  it('writes preferredFrameSize under the mcp-ui metadata key hosts actually read', () => {
    const resource = createUIResource({
      uri: 'ui://x/1',
      htmlString: '',
      preferredFrameSize: ['420px', '440px'],
    });
    expect(resource.resource._meta).toEqual({ [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: ['420px', '440px'] });
  });

  it('merges extra meta after the frame-size hint so a caller can override it', () => {
    const resource = createUIResource({
      uri: 'ui://x/1',
      htmlString: '',
      preferredFrameSize: ['1px', '2px'],
      meta: { [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: ['9px', '9px'], custom: true },
    });
    expect(resource.resource._meta).toEqual({
      [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: ['9px', '9px'],
      custom: true,
    });
  });

  it('exports the spec key for the template-registration flow it does not itself use', () => {
    expect(MCP_UI_RESOURCE_URI_META_KEY).toBe('ui/resourceUri');
    expect(UI_RESOURCE_MIME_TYPES).toContain(MCP_UI_MIME_TYPE);
  });
});

describe('buildUIToolResult', () => {
  it('puts the model-readable text first and the human-facing resource second', () => {
    const ui = createUIResource({ uri: 'ui://x/1', htmlString: '<p>secret-token-here</p>' });
    const result = buildUIToolResult({ modelText: 'A confirmation dialog is open.', ui });
    expect(result.content[0]).toEqual({ type: 'text', text: 'A confirmation dialog is open.' });
    expect(result.content[1]).toBe(ui);
    expect(result).not.toHaveProperty('_meta');
  });

  it('carries result-level meta when given some', () => {
    const ui = createUIResource({ uri: 'ui://x/1', htmlString: '' });
    expect(buildUIToolResult({ modelText: 't', ui, meta: { trace: 'abc' } })._meta).toEqual({ trace: 'abc' });
  });
});

describe('parseUIResource', () => {
  const valid = { type: 'resource', resource: { uri: 'ui://x/1', mimeType: MCP_UI_MIME_TYPE, text: '<p>ok</p>' } };

  it('narrows a well-formed resource', () => {
    expect(parseUIResource(valid)).toEqual(valid);
  });

  it('accepts every MIME type in the published union, not only the one this package emits', () => {
    for (const mimeType of UI_RESOURCE_MIME_TYPES) {
      expect(parseUIResource({ ...valid, resource: { ...valid.resource, mimeType } })).not.toBeUndefined();
    }
  });

  it('keeps a record-shaped _meta and drops a non-record one', () => {
    expect(parseUIResource({ ...valid, resource: { ...valid.resource, _meta: { a: 1 } } })?.resource._meta).toEqual({ a: 1 });
    expect(parseUIResource({ ...valid, resource: { ...valid.resource, _meta: 'nope' } })?.resource).not.toHaveProperty('_meta');
  });

  it.each([
    ['a non-object', 42],
    ['null', null],
    ['an array', [valid]],
    ['a non-resource type', { ...valid, type: 'text' }],
    ['a non-object resource', { type: 'resource', resource: 'nope' }],
    ['a non-string uri', { type: 'resource', resource: { ...valid.resource, uri: 7 } }],
    ['a non-ui:// uri', { type: 'resource', resource: { ...valid.resource, uri: 'https://evil.example' } }],
    ['a non-string mimeType', { type: 'resource', resource: { ...valid.resource, mimeType: 1 } }],
    ['an unrecognized mimeType', { type: 'resource', resource: { ...valid.resource, mimeType: 'application/json' } }],
    ['a non-string text', { type: 'resource', resource: { ...valid.resource, text: { body: 'x' } } }],
  ])('rejects %s', (_label, value) => {
    expect(parseUIResource(value)).toBeUndefined();
  });
});

describe('readPreferredFrameSize', () => {
  function withMeta(meta: Record<string, unknown> | undefined) {
    return parseUIResource({
      type: 'resource',
      resource: { uri: 'ui://x/1', mimeType: MCP_UI_MIME_TYPE, text: '', ...(meta === undefined ? {} : { _meta: meta }) },
    })!;
  }

  it('reads a well-formed pair', () => {
    expect(readPreferredFrameSize(withMeta({ [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: ['420px', '440px'] }))).toEqual([
      '420px',
      '440px',
    ]);
  });

  it.each([
    ['no _meta at all', undefined],
    ['no size key', { other: 1 }],
    ['a non-array value', { [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: '420px' }],
    ['a wrong-length array', { [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: ['420px'] }],
    ['a non-string width', { [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: [420, '440px'] }],
    ['a non-string height', { [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: ['420px', 440] }],
  ])('returns undefined for %s, so the host sizes the frame itself', (_label, meta) => {
    expect(readPreferredFrameSize(withMeta(meta as Record<string, unknown> | undefined))).toBeUndefined();
  });
});
