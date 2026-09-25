import { describe, expect, it } from 'vitest';
import type { ParseFailure } from '../agent-to-renderer.js';
import { createLabCatalog } from '../catalog.js';
import type { LocalFunctionAction } from '../common-types.js';
import { buildParseFailureResult, createA2uiInterpreter, runLocalFunctionAction } from '../interpreter.js';
import { parseRendererToAgentMessage } from '../renderer-to-agent.js';

const CATALOG_ID = createLabCatalog().catalogId;

function freshInterpreter() {
  return createA2uiInterpreter(createLabCatalog());
}

function createSurfaceMsg(surfaceId: string, extra: Record<string, unknown> = {}) {
  return { version: 'v1.0', createSurface: { surfaceId, catalogId: CATALOG_ID, ...extra } };
}

describe('createA2uiInterpreter — happy-path createSurface -> updateComponents -> updateDataModel', () => {
  it('processes the full sequence and produces a renderable surface', () => {
    const interpreter = freshInterpreter();

    const r1 = interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    expect(r1.rendererMessages).toEqual([]);

    const r2 = interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: {
        surfaceId: 's1',
        components: [
          { id: 'root', component: 'Column', children: ['title'] },
          { id: 'title', component: 'Text', text: { path: '/greeting' } },
        ],
      },
    });
    expect(r2.rendererMessages).toEqual([]);

    const r3 = interpreter.applyAgentMessage({ version: 'v1.0', updateDataModel: { surfaceId: 's1', path: '/greeting', value: 'Hello, Jini' } });
    expect(r3.rendererMessages).toEqual([]);

    const root = interpreter.getRoot('s1');
    expect(root).toMatchObject({ id: 'root', component: 'Column' });
    const surface = interpreter.getSurface('s1');
    expect(surface?.dataModel).toEqual({ greeting: 'Hello, Jini' });
    const resolved = interpreter.resolve('s1', { path: '/greeting' });
    expect(resolved).toEqual({ ok: true, value: 'Hello, Jini' });
  });

  it('getRoot is undefined until a component with id "root" actually arrives (forward-reference tolerance)', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: { surfaceId: 's1', components: [{ id: 'notRootYet', component: 'Text', text: 'hi' }] },
    });
    expect(interpreter.getRoot('s1')).toBeUndefined();
  });

  it('createSurface without an initial components list defaults to an empty component map and {} data model', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    const surface = interpreter.getSurface('s1');
    expect(surface?.components.size).toBe(0);
    expect(surface?.dataModel).toEqual({});
  });

  it('updateDataModel with no explicit path replaces the entire data model at the root', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1', { dataModel: { old: true } }));
    interpreter.applyAgentMessage({ version: 'v1.0', updateDataModel: { surfaceId: 's1', value: { fresh: true } } });
    expect(interpreter.getSurface('s1')?.dataModel).toEqual({ fresh: true });
  });

  it('getSurface returns undefined for a surface that was never created', () => {
    const interpreter = freshInterpreter();
    expect(interpreter.getSurface('never-created')).toBeUndefined();
  });
});

describe('createA2uiInterpreter — adversarial: unknown-catalog and duplicate-surface rejections', () => {
  it('rejects createSurface for a catalogId this interpreter does not have loaded', () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage(createSurfaceMsg('s1', { catalogId: 'not-the-loaded-catalog' }));
    expect(result.rendererMessages).toHaveLength(1);
    expect(result.rendererMessages[0]).toMatchObject({ error: { code: 'VALIDATION_FAILED', surfaceId: 's1' } });
    expect(interpreter.listSurfaceIds()).toEqual([]);
  });

  it('rejects creating a surface with an id that already exists, per the spec\'s own explicit rule', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    const result = interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    expect(result.rendererMessages).toMatchObject([{ error: { code: 'VALIDATION_FAILED', surfaceId: 's1' } }]);
  });

  it('re-creating a surface after deleteSurface succeeds', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    interpreter.applyAgentMessage({ version: 'v1.0', deleteSurface: { surfaceId: 's1' } });
    const result = interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    expect(result.rendererMessages).toEqual([]);
  });
});

describe('createA2uiInterpreter — adversarial: unknown surfaceId targets', () => {
  it('updateComponents against an unknown surfaceId is refused with a spec-shaped error', () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: { surfaceId: 'ghost', components: [{ id: 'root', component: 'Text', text: 'hi' }] },
    });
    expect(result.rendererMessages).toMatchObject([{ error: { code: 'VALIDATION_FAILED', surfaceId: 'ghost' } }]);
  });

  it('updateDataModel against an unknown surfaceId is refused', () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage({ version: 'v1.0', updateDataModel: { surfaceId: 'ghost', value: 1 } });
    expect(result.rendererMessages).toMatchObject([{ error: { code: 'VALIDATION_FAILED', surfaceId: 'ghost' } }]);
  });

  it('deleteSurface against an unknown surfaceId is refused', () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage({ version: 'v1.0', deleteSurface: { surfaceId: 'ghost' } });
    expect(result.rendererMessages).toMatchObject([{ error: { code: 'VALIDATION_FAILED', surfaceId: 'ghost' } }]);
  });
});

describe('createA2uiInterpreter — adversarial: component-graph shape (missing child / cycle)', () => {
  it('accepts a component referencing a child id that does not (yet) exist without crashing — per spec, renderers must handle forward references gracefully', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: { surfaceId: 's1', components: [{ id: 'root', component: 'Column', children: ['doesNotExist'] }] },
    });
    expect(result.rendererMessages).toEqual([]);
    expect(interpreter.getRoot('s1')?.props.children).toEqual(['doesNotExist']);
  });

  it('accepts a circular component reference (A references B references A) without throwing or hanging', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    expect(() =>
      interpreter.applyAgentMessage({
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's1',
          components: [
            { id: 'root', component: 'Column', children: ['a'] },
            { id: 'a', component: 'Column', children: ['root'] },
          ],
        },
      }),
    ).not.toThrow();
    const surface = interpreter.getSurface('s1')!;
    expect(surface.components.get('a')?.props.children).toEqual(['root']);
  });
});

describe('createA2uiInterpreter — adversarial: catalog enforcement (component type)', () => {
  it('refuses a component type not in the active catalog — it is not added to the surface', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: { surfaceId: 's1', components: [{ id: 'root', component: 'VideoPlayerNotInCatalog', src: 'x.mp4' }] },
    });
    expect(result.rendererMessages).toMatchObject([{ error: { code: 'VALIDATION_FAILED', surfaceId: 's1', path: '/components/0/component' } }]);
    expect(interpreter.getSurface('s1')?.components.has('root')).toBe(false);
  });

  it('applies valid components and reports errors for invalid ones in the same message, at per-component granularity', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: {
        surfaceId: 's1',
        components: [
          { id: 'root', component: 'Column', children: ['ok1'] },
          { id: 'bad', component: 'NotInCatalog' },
          { id: 'ok1', component: 'Text', text: 'fine' },
        ],
      },
    });
    expect(result.rendererMessages).toHaveLength(1);
    const surface = interpreter.getSurface('s1')!;
    expect(surface.components.has('root')).toBe(true);
    expect(surface.components.has('ok1')).toBe(true);
    expect(surface.components.has('bad')).toBe(false);
  });

  it('refuses a known component type with invalid/missing required props (e.g. Text without text)', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: { surfaceId: 's1', components: [{ id: 'root', component: 'Text' }] },
    });
    expect(result.rendererMessages).toMatchObject([{ error: { code: 'VALIDATION_FAILED' } }]);
    expect(interpreter.getSurface('s1')?.components.has('root')).toBe(false);
  });

  it('names the missing/invalid field in the human-readable message, not just the machine-readable path', () => {
    // Regression for a real refusal an admin saw with zero actionable detail: "Component "root"
    // (recharts.bar-chart) failed catalog validation: Required" — true but useless, since `path`
    // (which DOES name the field) never made it into `message`, the only part a chat UI shows.
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: { surfaceId: 's1', components: [{ id: 'root', component: 'Text' }] },
    });
    const error = (result.rendererMessages[0] as { error: { path: string; message: string } }).error;
    expect(error.path).toBe('/components/0/text');
    expect(error.message).toContain('text');
    expect(error.message).not.toMatch(/validation: Required$/);
  });

  it('a later updateComponents can overwrite an earlier component definition for the same id', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    interpreter.applyAgentMessage({ version: 'v1.0', updateComponents: { surfaceId: 's1', components: [{ id: 'root', component: 'Text', text: 'v1' }] } });
    interpreter.applyAgentMessage({ version: 'v1.0', updateComponents: { surfaceId: 's1', components: [{ id: 'root', component: 'Text', text: 'v2' }] } });
    expect(interpreter.getRoot('s1')?.props.text).toBe('v2');
  });
});

describe('createA2uiInterpreter — adversarial: callFunction / callableFrom execution boundary', () => {
  it('refuses a callFunction for a function marked callableFrom: rendererOnly, with code INVALID_FUNCTION_CALL — the exact case the spec text names', () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      functionCallId: 'call-1',
      wantResponse: true,
      callFunction: { call: 'adminReset' },
    });
    expect(result.rendererMessages).toMatchObject([{ error: { code: 'INVALID_FUNCTION_CALL', functionCallId: 'call-1' } }]);
  });

  it('refuses a callFunction for a function not registered at all, with the same INVALID_FUNCTION_CALL code', () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage({ version: 'v1.0', functionCallId: 'call-2', callFunction: { call: 'neverHeardOfIt' } });
    expect(result.rendererMessages).toMatchObject([{ error: { code: 'INVALID_FUNCTION_CALL', functionCallId: 'call-2' } }]);
  });

  it('allows a callFunction for an agentOnly function and returns a functionResponse when wantResponse is set', () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      functionCallId: 'call-3',
      wantResponse: true,
      callFunction: { call: 'logServerEvent' },
    });
    expect(result.rendererMessages).toMatchObject([{ functionResponse: { functionCallId: 'call-3', call: 'logServerEvent' } }]);
  });

  it('allows a callFunction for a rendererOrAgent function and resolves its args', () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      functionCallId: 'call-4',
      wantResponse: true,
      callFunction: { call: 'greetUser', args: { name: 'Ada' } },
    });
    expect(result.rendererMessages).toMatchObject([{ functionResponse: { functionCallId: 'call-4', value: 'Hello, Ada!' } }]);
  });

  it('produces no renderer message for an allowed call when wantResponse is not set', () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage({ version: 'v1.0', functionCallId: 'call-5', callFunction: { call: 'greetUser', args: { name: 'X' } } });
    expect(result.rendererMessages).toEqual([]);
  });

  it('documented gap: a DataBinding-typed callFunction arg cannot resolve (callFunction carries no surfaceId/data model on the wire) — degrades to an error, not a crash', () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      functionCallId: 'call-6',
      wantResponse: true,
      callFunction: { call: 'greetUser', args: { name: { path: '/whatever' } } },
    });
    expect(result.rendererMessages).toMatchObject([{ error: { code: 'PATH_NOT_FOUND', functionCallId: 'call-6' } }]);
  });

  // Regression (2026-07-29 audit): the reachable end of `resolve.ts`'s broken never-throws
  // contract. `FunctionCall.args` accepts a plain object (`ArgValueSchema`'s record branch), so
  // `{path: 7}` passes wire validation, is then misread as a DataBinding, and used to throw
  // `path.startsWith is not a function` straight out of applyAgentMessage — through the host's
  // render, with no error boundary between here and the chat React root.
  it('a callFunction arg shaped like a binding but with a non-string path does not throw out of applyAgentMessage', () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      functionCallId: 'call-7',
      wantResponse: true,
      callFunction: { call: 'greetUser', args: { name: { path: 7 } } },
    });
    // Not a binding, so it reaches the impl as the literal object it is; greetUser's own
    // non-string fallback then applies.
    expect(result.rendererMessages).toMatchObject([{ functionResponse: { functionCallId: 'call-7', value: 'Hello, there!' } }]);
  });

  it('reports a void function\'s return as null rather than omitting it from the wire message', () => {
    // `renderer_to_agent.json` requires `functionResponse.value`, and JSON has no `undefined` —
    // a function that returns nothing must say `null`, or the emitted message is one this
    // package's own parser (correctly) refuses.
    const interpreter = freshInterpreter();
    const [message] = interpreter.applyAgentMessage({
      version: 'v1.0',
      functionCallId: 'call-8',
      wantResponse: true,
      callFunction: { call: 'logServerEvent' },
    }).rendererMessages;
    expect(message).toEqual({
      version: 'v1.0',
      functionResponse: { functionCallId: 'call-8', call: 'logServerEvent', value: null },
    });
    expect(parseRendererToAgentMessage(message).ok).toBe(true);
  });
});

// Regression (2026-07-29 audit). `updateDataModel.value` is required by the real schema, but
// `z.unknown()` accepted its absence — so `{updateDataModel: {surfaceId: "s1"}}` parsed, and
// `setAtPointer(model, '/', undefined)` replaced the surface's entire data model with
// `undefined`. No error, no renderer message: a whole surface's state silently gone.
describe('createA2uiInterpreter — a value-less updateDataModel cannot erase a data model', () => {
  it('refuses the message and leaves the data model exactly as it was', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1', { dataModel: { greeting: 'Hello', count: 3 } }));

    const result = interpreter.applyAgentMessage({ version: 'v1.0', updateDataModel: { surfaceId: 's1' } });

    expect(result.rendererMessages).toMatchObject([
      { error: { code: 'VALIDATION_FAILED', surfaceId: 's1', path: '/updateDataModel/value' } },
    ]);
    expect(interpreter.getSurface('s1')?.dataModel).toEqual({ greeting: 'Hello', count: 3 });
  });

  it('refuses it at a nested path too, rather than deleting the key', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1', { dataModel: { user: { name: 'Ada' } } }));
    interpreter.applyAgentMessage({ version: 'v1.0', updateDataModel: { surfaceId: 's1', path: '/user/name' } });
    expect(interpreter.getSurface('s1')?.dataModel).toEqual({ user: { name: 'Ada' } });
  });

  it('still accepts an explicit null, which is the spec\'s own delete verb', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1', { dataModel: { user: { name: 'Ada' } } }));
    const result = interpreter.applyAgentMessage({ version: 'v1.0', updateDataModel: { surfaceId: 's1', path: '/user/name', value: null } });
    expect(result.rendererMessages).toEqual([]);
    expect(interpreter.getSurface('s1')?.dataModel).toEqual({ user: {} });
  });
});

describe('createA2uiInterpreter — rapid-fire updates stay consistent', () => {
  it('applies many updateDataModel messages in sequence with no lost or interleaved writes', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    for (let i = 0; i < 50; i += 1) {
      interpreter.applyAgentMessage({ version: 'v1.0', updateDataModel: { surfaceId: 's1', path: `/counter${i}`, value: i } });
    }
    const dataModel = interpreter.getSurface('s1')?.dataModel as Record<string, number>;
    for (let i = 0; i < 50; i += 1) expect(dataModel[`counter${i}`]).toBe(i);
  });

  it('applies many updateComponents messages in sequence, each visible immediately to the next', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    for (let i = 0; i < 30; i += 1) {
      interpreter.applyAgentMessage({
        version: 'v1.0',
        updateComponents: { surfaceId: 's1', components: [{ id: `node${i}`, component: 'Text', text: `t${i}` }] },
      });
    }
    const surface = interpreter.getSurface('s1')!;
    expect(surface.components.size).toBe(30);
    expect(surface.components.get('node29')?.props.text).toBe('t29');
  });
});

describe('createA2uiInterpreter — adversarial: deleteSurface mid-flight action', () => {
  it('a deleteSurface right after a wantResponse action was dispatched leaves a later actionResponse as a graceful no-op, not a crash', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: {
        surfaceId: 's1',
        components: [{ id: 'root', component: 'Button', child: 'label', action: { event: { name: 'confirm', wantResponse: true, responsePath: '/confirmed' } } }, { id: 'label', component: 'Text', text: 'Go' }],
      },
    });

    const built = interpreter.buildAction('s1', 'root');
    expect(built.ok).toBe(true);
    if (!built.ok || built.kind !== 'agent') throw new Error('expected an agent action');
    const actionId = (built.message as { action: { actionId?: string } }).action.actionId;
    expect(actionId).toBeTruthy();

    // Surface is torn down while the action is still "in flight" (no actionResponse received yet).
    interpreter.applyAgentMessage({ version: 'v1.0', deleteSurface: { surfaceId: 's1' } });
    expect(interpreter.listSurfaceIds()).toEqual([]);

    // The late actionResponse must not throw and must not resurrect the surface.
    const result = interpreter.applyAgentMessage({ version: 'v1.0', actionId: actionId!, actionResponse: { value: true } });
    expect(result.rendererMessages).toEqual([]);
    expect(interpreter.listSurfaceIds()).toEqual([]);
  });

  it('an actionResponse for an actionId that was never issued is also a graceful no-op', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    const result = interpreter.applyAgentMessage({ version: 'v1.0', actionId: 'never-issued', actionResponse: { value: 1 } });
    expect(result.rendererMessages).toEqual([]);
  });

  it('a normal (non-deleted) actionResponse writes its value into the data model at responsePath', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: {
        surfaceId: 's1',
        components: [{ id: 'root', component: 'Button', child: 'label', action: { event: { name: 'confirm', wantResponse: true, responsePath: '/answer' } } }, { id: 'label', component: 'Text', text: 'Go' }],
      },
    });
    const built = interpreter.buildAction('s1', 'root');
    if (!built.ok || built.kind !== 'agent') throw new Error('expected an agent action');
    const actionId = (built.message as { action: { actionId?: string } }).action.actionId!;
    interpreter.applyAgentMessage({ version: 'v1.0', actionId, actionResponse: { value: 'yes' } });
    expect(interpreter.getSurface('s1')?.dataModel).toMatchObject({ answer: 'yes' });
  });
});

describe('createA2uiInterpreter — adversarial: malformed envelopes never mutate state', () => {
  it('missing version produces an unattributed violation, not a state mutation', () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage({ deleteSurface: { surfaceId: 's1' } });
    expect(result.rendererMessages).toEqual([]);
    expect(result.unattributedViolation).toBeDefined();
  });

  it('an ambiguous (two message-type keys) envelope is rejected without applying either half', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      updateDataModel: { surfaceId: 's1', value: { poisoned: true } },
      deleteSurface: { surfaceId: 's1' },
    });
    expect(result.unattributedViolation).toBeDefined();
    expect(interpreter.getSurface('s1')?.dataModel).toEqual({});
    expect(interpreter.listSurfaceIds()).toEqual(['s1']);
  });

  it('a message body that fails schema validation but does carry a readable surfaceId still gets a spec-shaped, attributed error (not the out-of-band channel)', () => {
    const interpreter = freshInterpreter();
    // `path` must be a string per the real schema — sending a number fails UpdateDataModelMessageSchema
    // validation (this is a genuine parse failure, distinct from the "unknown surfaceId" rejection
    // handleUpdateDataModel produces for a *well-formed* message targeting a surface that doesn't
    // exist yet — this test never reaches handleUpdateDataModel at all).
    const result = interpreter.applyAgentMessage({ version: 'v1.0', updateDataModel: { surfaceId: 's1', path: 123, value: 'x' } });
    expect(result.unattributedViolation).toBeUndefined();
    expect(result.rendererMessages).toMatchObject([{ error: { code: 'VALIDATION_FAILED', surfaceId: 's1' } }]);
  });

  it('a message body that fails schema validation with NO extractable surfaceId (callFunction/actionResponse have none on the wire) falls back to the out-of-band channel', () => {
    const interpreter = freshInterpreter();
    // functionCallId is required — omitting it is a genuine CallFunctionMessageSchema failure, and
    // callFunction has no surfaceId field at all to fall back to.
    const result = interpreter.applyAgentMessage({ version: 'v1.0', callFunction: { call: 'greetUser' } });
    expect(result.rendererMessages).toEqual([]);
    expect(result.unattributedViolation).toBeDefined();
  });

  it('an envelope with an unrecognized message-type key is routed to the out-of-band channel via applyAgentMessage directly', () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage({ version: 'v1.0', notARealKey: {} });
    expect(result.rendererMessages).toEqual([]);
    expect(result.unattributedViolation).toMatch(/none of the known message-type keys/);
  });

  it('an envelope with an unsupported version string is routed to the out-of-band channel via applyAgentMessage directly', () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage({ version: 'v0.9', deleteSurface: { surfaceId: 's1' } });
    expect(result.rendererMessages).toEqual([]);
    expect(result.unattributedViolation).toMatch(/only supports/);
  });

  it('regression: a raw envelope that is not an object at all (e.g. null) is rejected without throwing — Object.keys(null) would crash a naive implementation', () => {
    const interpreter = freshInterpreter();
    expect(() => interpreter.applyAgentMessage(null)).not.toThrow();
    expect(() => interpreter.applyAgentMessage('just a string')).not.toThrow();
    const result = interpreter.applyAgentMessage(null);
    expect(result.rendererMessages).toEqual([]);
    expect(result.unattributedViolation).toBeDefined();
  });

  it('regression: an unrelated extra top-level key ahead of the real message key does not misattribute the surfaceId lookup', () => {
    const interpreter = freshInterpreter();
    // Object insertion order puts "aaaFirstJunkKey" before "updateDataModel" — a naive
    // "first non-version key" lookup would look for `.surfaceId` on the wrong value entirely
    // (a boolean, which safely yields no surfaceId) instead of skipping straight to the one
    // recognized message-type key.
    const result = interpreter.applyAgentMessage({ version: 'v1.0', aaaFirstJunkKey: true, updateDataModel: { surfaceId: 's1', path: 123, value: 1 } });
    expect(result.rendererMessages).toMatchObject([{ error: { code: 'VALIDATION_FAILED', surfaceId: 's1' } }]);
  });

  it("a message-type key's value being a non-object (so no .surfaceId can be read off it) falls back to the out-of-band channel", () => {
    const interpreter = freshInterpreter();
    const result = interpreter.applyAgentMessage({ version: 'v1.0', updateDataModel: 'oops, not an object' });
    expect(result.rendererMessages).toEqual([]);
    expect(result.unattributedViolation).toBeDefined();
  });
});

describe('createA2uiInterpreter — buildAction', () => {
  it('returns ok:false for an unknown surface or component', () => {
    const interpreter = freshInterpreter();
    expect(interpreter.buildAction('ghost', 'x').ok).toBe(false);
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    expect(interpreter.buildAction('s1', 'ghost').ok).toBe(false);
  });

  it('returns ok:false for a component with no action prop', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    interpreter.applyAgentMessage({ version: 'v1.0', updateComponents: { surfaceId: 's1', components: [{ id: 'root', component: 'Text', text: 'hi' }] } });
    expect(interpreter.buildAction('s1', 'root').ok).toBe(false);
  });

  it('executes a local (functionCall) action synchronously and returns its result, without producing a wire message', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: {
        surfaceId: 's1',
        components: [{ id: 'root', component: 'Button', child: 'label', action: { functionCall: { call: 'greetUser', args: { name: 'Ada' } } } }, { id: 'label', component: 'Text', text: 'Go' }],
      },
    });
    const built = interpreter.buildAction('s1', 'root');
    expect(built).toEqual({ ok: true, kind: 'local', result: 'Hello, Ada!' });
  });

  it('adversarial: a local (functionCall) action that crosses the callableFrom boundary the other direction (renderer invoking an agentOnly function) is refused, not silently run', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: {
        surfaceId: 's1',
        components: [{ id: 'root', component: 'Button', child: 'label', action: { functionCall: { call: 'logServerEvent' } } }, { id: 'label', component: 'Text', text: 'Go' }],
      },
    });
    const built = interpreter.buildAction('s1', 'root');
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error('expected refusal');
    expect(built.reason).toMatch(/logServerEvent/);
  });

  it('resolves context bindings against the surface data model, substituting null for an unresolved one instead of failing the whole dispatch', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1', { dataModel: { itemId: 'sku-1' } }));
    interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: {
        surfaceId: 's1',
        components: [
          { id: 'root', component: 'Button', child: 'label', action: { event: { name: 'select', context: { itemId: { path: '/itemId' }, ghost: { path: '/nope' }, literal: 'x' } } } },
          { id: 'label', component: 'Text', text: 'Go' },
        ],
      },
    });
    const built = interpreter.buildAction('s1', 'root', () => 0);
    expect(built.ok).toBe(true);
    if (!built.ok || built.kind !== 'agent') throw new Error('expected agent action');
    expect(built.message).toMatchObject({ action: { name: 'select', context: { itemId: 'sku-1', ghost: null, literal: 'x' } } });
  });

  it('does not register a pendingAction (and omits actionId) when wantResponse is not set', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: { surfaceId: 's1', components: [{ id: 'root', component: 'Button', child: 'label', action: { event: { name: 'ping' } } }, { id: 'label', component: 'Text', text: 'Go' }] },
    });
    const built = interpreter.buildAction('s1', 'root');
    if (!built.ok || built.kind !== 'agent') throw new Error('expected agent action');
    expect('actionId' in (built.message as { action: object }).action).toBe(false);
  });
});

describe('createA2uiInterpreter — resolve() item-scope forwarding', () => {
  it('resolves a relative path when both itemBasePath and itemIndex are supplied', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1', { dataModel: { items: [{ label: 'a' }, { label: 'b' }] } }));
    expect(interpreter.resolve('s1', { path: 'label' }, '/items', 1)).toEqual({ ok: true, value: 'b' });
  });

  it('treats a partially-supplied item scope (only one of itemBasePath/itemIndex) as no scope at all', () => {
    const interpreter = freshInterpreter();
    interpreter.applyAgentMessage(createSurfaceMsg('s1', { dataModel: { items: [{ label: 'a' }] } }));
    expect(interpreter.resolve('s1', { path: 'label' }, '/items')).toMatchObject({ ok: false, reason: 'RELATIVE_PATH_OUTSIDE_LIST_CONTEXT' });
    expect(interpreter.resolve('s1', { path: 'label' }, undefined, 0)).toMatchObject({ ok: false, reason: 'RELATIVE_PATH_OUTSIDE_LIST_CONTEXT' });
  });
});

describe('createA2uiInterpreter — subscribe', () => {
  it('notifies subscribers after a state-changing message, and stops after unsubscribe', () => {
    const interpreter = freshInterpreter();
    let calls = 0;
    const unsubscribe = interpreter.subscribe(() => {
      calls += 1;
    });
    interpreter.applyAgentMessage(createSurfaceMsg('s1'));
    expect(calls).toBe(1);
    unsubscribe();
    interpreter.applyAgentMessage(createSurfaceMsg('s2'));
    expect(calls).toBe(1);
  });
});

describe('buildParseFailureResult', () => {
  it('routes every envelope-shape failure code straight to the out-of-band channel, never a wire message', () => {
    for (const code of ['MISSING_VERSION', 'UNSUPPORTED_VERSION', 'NO_MESSAGE_KEY', 'AMBIGUOUS_MESSAGE'] as const) {
      const parsed: ParseFailure = { ok: false, code, message: `msg-${code}` };
      expect(buildParseFailureResult(parsed, {})).toEqual({
        rendererMessages: [],
        unattributedViolation: `msg-${code}`,
      });
    }
  });

  it('attributes a VALIDATION_FAILED failure to the surfaceId readable off the one recognized message-type key', () => {
    const parsed: ParseFailure = {
      ok: false,
      code: 'VALIDATION_FAILED',
      message: 'path must be a string',
      path: '/updateDataModel/path',
    };
    const raw = { version: 'v1.0', updateDataModel: { surfaceId: 's1', path: 123, value: 'x' } };

    expect(buildParseFailureResult(parsed, raw)).toEqual({
      rendererMessages: [{
        version: 'v1.0',
        error: { code: 'VALIDATION_FAILED', surfaceId: 's1', path: '/updateDataModel/path', message: 'path must be a string' },
      }],
    });
  });

  it('falls back to the out-of-band channel when no known message-type key carries a readable surfaceId', () => {
    const parsed: ParseFailure = {
      ok: false,
      code: 'VALIDATION_FAILED',
      message: 'functionCallId is required',
      path: '/functionCallId',
    };
    const raw = { version: 'v1.0', callFunction: { call: 'greetUser' } };

    expect(buildParseFailureResult(parsed, raw)).toEqual({
      rendererMessages: [],
      unattributedViolation: 'functionCallId is required',
    });
  });

  it('ignores a surfaceId-shaped field sitting under a key that is not one of the six known message types', () => {
    const parsed: ParseFailure = {
      ok: false,
      code: 'VALIDATION_FAILED',
      message: 'value is required',
      path: '/updateDataModel/value',
    };
    const raw = { version: 'v1.0', notAKnownKey: { surfaceId: 'wrong' }, updateDataModel: { surfaceId: 's1' } };

    expect(buildParseFailureResult(parsed, raw)).toMatchObject({
      rendererMessages: [{ error: { surfaceId: 's1' } }],
    });
  });
});

describe('runLocalFunctionAction', () => {
  it('resolves a rendererOrAgent local functionCall against the given catalog', () => {
    const catalog = createLabCatalog();
    const action: LocalFunctionAction = { functionCall: { call: 'greetUser', args: { name: 'Ada' } } };

    expect(runLocalFunctionAction({}, catalog, action)).toEqual({ ok: true, kind: 'local', result: 'Hello, Ada!' });
  });

  it('resolves functionCall args as DataBindings against the supplied data model', () => {
    const catalog = createLabCatalog();
    const action: LocalFunctionAction = { functionCall: { call: 'greetUser', args: { name: { path: '/name' } } } };

    expect(runLocalFunctionAction({ name: 'Grace' }, catalog, action))
      .toEqual({ ok: true, kind: 'local', result: 'Hello, Grace!' });
  });

  it('refuses a call that crosses the callableFrom boundary (agentOnly, invoked from the renderer side) rather than running it', () => {
    const catalog = createLabCatalog();
    const action: LocalFunctionAction = { functionCall: { call: 'logServerEvent' } };

    const result = runLocalFunctionAction({}, catalog, action);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.reason).toMatch(/logServerEvent/);
  });

  it('refuses a call to a function not registered in the catalog at all', () => {
    const catalog = createLabCatalog();
    const action: LocalFunctionAction = { functionCall: { call: 'neverHeardOfIt' } };

    const result = runLocalFunctionAction({}, catalog, action);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.reason).toMatch(/neverHeardOfIt/);
  });
});
