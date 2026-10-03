import { expect, it } from 'vitest';
import { buildGlueCapabilityGate, GlueCapabilityDeniedError, dispatchGlueAttachment } from '../glue/index.js';

it('preserves both delegate argument objects and constructor data', () => {
  const required = { item: 1 }, optional = { verbose: true };
  const calls: unknown[] = [];
  const gate = buildGlueCapabilityGate({ moduleId: 'module', vocabulary: ['read', 'write'], capabilities: ['read'], coreDelegates: {
    read: (args, options) => { calls.push([args, options]); return 'read'; },
  } }, {});
  expect(gate.read!(required, optional)).toBe('read');
  expect(calls).toEqual([[required, optional]]);
  expect(() => gate.write!({})).toThrow(GlueCapabilityDeniedError);
  const error = new GlueCapabilityDeniedError({ moduleId: 'module', capability: 'write' });
  expect([error.moduleId, error.capability]).toEqual(['module', 'write']);
});

it('passes a required object to injected attachment dispatch and refuses unwired sites', () => {
  const calls: unknown[] = [];
  const dispatch = (required: { moduleId: string; callSite: string; payload: Readonly<Record<string, unknown>> }) => { calls.push(required); return 17; };
  const required = { moduleId: 'module', callSite: 'render', payload: { item: 1 }, dispatch };
  expect(dispatchGlueAttachment({ ...required, wiredCallSites: ['render'] })).toEqual({ wired: true, result: 17 });
  expect(calls).toEqual([{ moduleId: 'module', callSite: 'render', payload: { item: 1 } }]);
  expect(dispatchGlueAttachment({ ...required, wiredCallSites: [] })).toEqual({ wired: false, code: 'UNWIRED_CALL_SITE' });
  expect(calls).toHaveLength(1);
});



