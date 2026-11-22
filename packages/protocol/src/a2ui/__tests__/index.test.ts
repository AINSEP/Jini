import { createIds } from './fixture-ports.js';
import { describe, expect, it } from 'vitest';
import * as a2ui from '../index.js';

// Exercises the public root barrel end to end (not just individual modules in isolation), the
// same shape the createSurface -> updateComponents -> updateDataModel fixture in
// examples/reference-web actually drives.
describe('@jini-ai/a2ui public barrel', () => {
  it('re-exports the interpreter factory and catalog builder, wired end to end', () => {
    expect(typeof a2ui.createA2uiInterpreter).toBe('function');
    expect(typeof a2ui.createLabCatalog).toBe('function');

    const interpreter = a2ui.createA2uiInterpreter({ catalog: a2ui.createLabCatalog({}), clock: { nowMs: () => Date.now() }, ids: createIds({}) });
    const catalogId = a2ui.createLabCatalog({}).catalogId;
    interpreter.applyAgentMessage({ raw: { version: 'v1.0', createSurface: { surfaceId: 's1', catalogId, components: [{ id: 'root', component: 'Text', text: 'hi' }] } } });
    expect(interpreter.getRoot({ surfaceId: 's1' })?.props.text).toBe('hi');
  });

  it('re-exports the wire parsers', () => {
    expect(a2ui.parseAgentToRendererMessage({ raw: { version: 'v1.0', deleteSurface: { surfaceId: 's1' } } }).ok).toBe(true);
    expect(a2ui.parseRendererToAgentMessage({ raw: a2ui.buildValidationFailedMessage({ surfaceId: 's1', path: '/x', message: 'm' }) }).ok).toBe(true);
  });

  it('re-exports the JSON Pointer + tree utilities', () => {
    expect(a2ui.getAtPointer({ doc: { a: 1 }, pointer: '/a' })).toEqual({ found: true, value: 1 });
    expect(a2ui.flattenRenderTree({ components: new Map([['a', { id: 'a' }]]), rootId: 'a', getChildIds: () => [] })).toEqual([{ id: 'a', depth: 0, status: 'ok' }]);
  });
});
