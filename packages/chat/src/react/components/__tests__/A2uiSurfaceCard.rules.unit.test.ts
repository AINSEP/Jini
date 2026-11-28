import { describe, expect, it } from 'vitest';
import { parseDynamicValue, type A2uiInterpreter } from '@jini-ai/protocol/a2ui';
import { createA2uiCardNodeHelpers } from '../A2uiSurfaceCard.rules.js';

/** Strict fake: only `resolve` is part of what resolveText may touch; every other call fails the test. */
function recordingInterpreter() {
  const resolved: unknown[] = [];
  const unused = (name: string) => () => { throw new Error(`resolveText must not call ${name}`); };
  const interpreter: A2uiInterpreter = {
    applyAgentMessage: unused('applyAgentMessage'),
    getSurface: unused('getSurface'),
    listSurfaceIds: unused('listSurfaceIds'),
    getRoot: unused('getRoot'),
    buildAction: unused('buildAction'),
    subscribe: unused('subscribe'),
    resolve: ({ surfaceId, value }) => { resolved.push({ surfaceId, value }); return { ok: true, value: 'resolved text' }; },
  };
  return { interpreter, resolved };
}

const helpers = (interpreter: A2uiInterpreter) => createA2uiCardNodeHelpers({
  interpreter, surfaceId: 'surface-1', renderNode: () => null,
  childProps: { interpreter, surfaceId: 'surface-1', ancestors: new Set<string>(), onAction: () => {}, registry: { list: () => [], resolveById: () => null } },
});

describe('createA2uiCardNodeHelpers resolveText', () => {
  it('refuses a text value that is no A2UI dynamic value with the protocol parse error, before resolving anything', () => {
    const { interpreter, resolved } = recordingInterpreter();
    const notDynamic = { path: 5 };
    const parsed = parseDynamicValue({ value: notDynamic });
    expect(parsed.ok).toBe(false);
    const expectedMessage = parsed.ok ? '' : parsed.error;
    expect(expectedMessage.length).toBeGreaterThan(0);
    expect(() => helpers(interpreter).resolveText(notDynamic)).toThrow(new Error(expectedMessage));
    expect(resolved, 'An invalid wire value never reaches the interpreter').toEqual([]);
  });
});
