import { describe, expect, it } from 'vitest';
import * as a2ui from '../index.js';

// Exercises the public root barrel end to end (not just individual modules in isolation), the
// same shape the createSurface -> updateComponents -> updateDataModel fixture in
// examples/reference-web actually drives.
describe('@jini-ai/a2ui public barrel', () => {
  it('re-exports the interpreter factory and catalog builder, wired end to end', () => {
    expect(typeof a2ui.createA2uiInterpreter).toBe('function');
    expect(typeof a2ui.createLabCatalog).toBe('function');

    const interpreter = a2ui.createA2uiInterpreter(a2ui.createLabCatalog());
    const catalogId = a2ui.createLabCatalog().catalogId;
    interpreter.applyAgentMessage({ version: 'v1.0', createSurface: { surfaceId: 's1', catalogId, components: [{ id: 'root', component: 'Text', text: 'hi' }] } });
    expect(interpreter.getRoot('s1')?.props.text).toBe('hi');
  });

  it('re-exports the wire parsers', () => {
    expect(a2ui.parseAgentToRendererMessage({ version: 'v1.0', deleteSurface: { surfaceId: 's1' } }).ok).toBe(true);
    expect(a2ui.parseRendererToAgentMessage(a2ui.buildValidationFailedMessage('s1', '/x', 'm')).ok).toBe(true);
  });

  it('re-exports the JSON Pointer + tree utilities', () => {
    expect(a2ui.getAtPointer({ a: 1 }, '/a')).toEqual({ found: true, value: 1 });
    expect(a2ui.flattenRenderTree(new Map([['a', { id: 'a' }]]), 'a', () => [])).toEqual([{ id: 'a', depth: 0, status: 'ok' }]);
  });
});
