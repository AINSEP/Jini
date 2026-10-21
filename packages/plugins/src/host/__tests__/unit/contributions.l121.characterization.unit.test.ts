import { describe, expect, it, vi } from 'vitest';
import { createPluginContributionCapture, type PluginToolContribution } from '../../contributions.js';
import type { PluginManifest } from '../../manifest.js';
import type { PluginSdk } from '../../ports.js';

const manifest: PluginManifest = { id: 'sample', name: 'Sample', version: '1.0.0', sdkRange: '*', engine: 1, tier: 'tier-3', capabilities: [], hooks: [], fields: [], integrity: {}, contributes: { tools: ['hello', 'other'], widgets: ['hello'] } };
const sdk: PluginSdk = {
  content: { read: () => ({ workspaceId: 'workspace', ext: {} }), extend: () => {} },
  addFilter: () => {}, addAction: () => {}, addContribution: () => {},
  routes: { add: () => {} }, tools: { add: () => {} }, widgets: { add: () => {} },
};
const tool: PluginToolContribution = { name: 'hello', description: 'Hello', inputSchema: { type: 'object' }, handler: () => 'hello' };

describe('tool contribution capture before L121', () => {
  it('detaches nested JSON schema state, freezes the tool and retains handler identity', () => {
    const capture = createPluginContributionCapture({ manifest });
    const schema = { type: 'object', properties: { value: { type: 'string' } } };
    capture.tools.add({ ...tool, inputSchema: schema });
    schema.properties.value.type = 'number';
    const snapshot = capture.seal({ sdk });
    expect(snapshot.tools[0]).toEqual({ ...tool, inputSchema: { type: 'object', properties: { value: { type: 'string' } } } });
    expect(snapshot.tools[0]!.handler).toBe(tool.handler);
    expect(Object.isFrozen(snapshot.tools[0])).toBe(true);
    expect(Object.isFrozen(snapshot.tools)).toBe(true);
    expect(snapshot.sdk).toBe(sdk);
  });
  it.each([null, 3, '', ' ', 'x'.repeat(8001)])('rejects a bad description before inspecting schema: %j', description => {
    const capture = createPluginContributionCapture({ manifest });
    const readSchema = vi.fn(() => ({ type: 'object' }));
    const value = { ...tool, description, get inputSchema() { return readSchema(); } } as unknown as PluginToolContribution;
    expect(() => capture.tools.add(value)).toThrow('plugin tool handler and description are required');
    expect(readSchema).not.toHaveBeenCalled();
    expect(capture.seal({ sdk }).tools).toEqual([]);
  });
  it('rejects a missing handler', () => {
    const capture = createPluginContributionCapture({ manifest });
    expect(() => capture.tools.add({ ...tool, handler: null } as unknown as PluginToolContribution)).toThrow('plugin tool handler and description are required');
  });
  it.each([undefined, null, false, 1, 'object', [], {}, { type: 'array' }].map(inputSchema => ({ inputSchema })))('rejects a schema that does not describe an object: %j', ({ inputSchema }) => {
    const capture = createPluginContributionCapture({ manifest });
    expect(() => capture.tools.add({ ...tool, inputSchema } as unknown as PluginToolContribution)).toThrow('plugin tool input schema must describe an object');
    capture.tools.add(tool);
    expect(capture.seal({ sdk }).tools).toEqual([tool]);
  });
  it('accepts the description length boundary and a description containing surrounding whitespace', () => {
    for (const description of ['x'.repeat(8000), ' hello ']) {
      const capture = createPluginContributionCapture({ manifest });
      capture.tools.add({ ...tool, description });
      expect(capture.seal({ sdk }).tools[0]!.description).toBe(description);
    }
  });
  it('counts UTF-8 bytes of serialized schemas and permits exactly 65536 bytes', () => {
    const capture = createPluginContributionCapture({ manifest });
    const schema = { type: 'object', description: '' };
    const overhead = new TextEncoder().encode(JSON.stringify(schema)).byteLength;
    const exact = { ...schema, description: 'x'.repeat(65536 - overhead) };
    capture.tools.add({ ...tool, inputSchema: exact });
    expect(() => capture.tools.add({ ...tool, name: 'other', inputSchema: { ...exact, description: `${exact.description}x` } })).toThrow('plugin tool schema is too large');
    expect(() => capture.tools.add({ ...tool, name: 'other', inputSchema: { ...schema, description: 'é'.repeat(32768) } })).toThrow('plugin tool schema is too large');
    expect(capture.seal({ sdk }).tools).toEqual([{ ...tool, inputSchema: exact }]);
  });
  it('propagates JSON serialization errors without capturing a tool', () => {
    const capture = createPluginContributionCapture({ manifest });
    const schema: Record<string, unknown> = { type: 'object' };
    schema.self = schema;
    expect(() => capture.tools.add({ ...tool, inputSchema: schema })).toThrow(TypeError);
    capture.tools.add(tool);
    expect(capture.seal({ sdk }).tools).toEqual([tool]);
  });
  it.each([null, [], {}, { type: 'array' }])('refuses a serialized schema that no longer describes an object: %j', serialized => {
    const capture = createPluginContributionCapture({ manifest });
    expect(() => capture.tools.add({ ...tool, inputSchema: { type: 'object', toJSON: () => serialized } })).toThrow('plugin tool input schema must describe an object');
    expect(capture.seal({ sdk }).tools).toEqual([]);
  });
  it('spreads tool properties before parsing the serialized schema', () => {
    const capture = createPluginContributionCapture({ manifest });
    const failure = new Error('spread getter failed');
    let handlerReads = 0;
    const value: PluginToolContribution = {
      ...tool, inputSchema: { type: 'object', toJSON: () => undefined },
      get handler() {
        handlerReads += 1;
        if (handlerReads === 2) throw failure;
        return tool.handler;
      },
    };
    expect(() => capture.tools.add(value)).toThrow(failure);
    expect(handlerReads).toBe(2);
    expect(capture.seal({ sdk }).tools).toEqual([]);
  });
  it('propagates JSON parsing failures without capturing a tool', () => {
    const capture = createPluginContributionCapture({ manifest });
    expect(() => capture.tools.add({ ...tool, inputSchema: { type: 'object', toJSON: () => undefined } })).toThrow(SyntaxError);
    expect(capture.seal({ sdk }).tools).toEqual([]);
  });
  it('checks duplicates before reading handler, description or schema', () => {
    const capture = createPluginContributionCapture({ manifest });
    capture.tools.add(tool);
    expect(() => capture.tools.add({ ...tool, description: '', inputSchema: {}, handler: null } as unknown as PluginToolContribution)).toThrow('duplicate plugin tool');
    expect(capture.seal({ sdk }).tools).toEqual([tool]);
  });
  it.each(['unknown', 'Hello', 'bad.name'])('checks declared names before tool shape: %s', name => {
    const capture = createPluginContributionCapture({ manifest });
    expect(() => capture.tools.add({ ...tool, name, description: '' })).toThrow(`undeclared plugin contribution '${name}'`);
  });
  it('requires an explicit tool declaration', () => {
    const { contributes: _contributes, ...undeclaredManifest } = manifest;
    const capture = createPluginContributionCapture({ manifest: undeclaredManifest });
    expect(() => capture.tools.add(tool)).toThrow("undeclared plugin contribution 'hello'");
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses invalid contribution limits: %s', maxContributions => {
    expect(() => createPluginContributionCapture({ manifest }, { maxContributions })).toThrow('invalid contribution limit');
  });
  it('counts widgets against the same contribution limit before tool validation', () => {
    const capture = createPluginContributionCapture({ manifest }, { maxContributions: 1 });
    capture.widgets.add({ name: 'hello', render: () => 'hello' });
    expect(() => capture.tools.add({ ...tool, description: '' })).toThrow('plugin contribution limit reached');
    expect(capture.seal({ sdk }).tools).toEqual([]);
  });
  it('rejects worker captures and then prioritizes sealing over the worker check', () => {
    const capture = createPluginContributionCapture({ manifest: { ...manifest, tier: 'tier-2' } });
    expect(() => capture.tools.add(tool)).toThrow('worker contributions are not supported yet');
    capture.seal({ sdk });
    expect(() => capture.tools.add(tool)).toThrow('plugin contribution capture is sealed');
  });
});
