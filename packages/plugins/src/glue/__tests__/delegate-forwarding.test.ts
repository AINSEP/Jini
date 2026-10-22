import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildGlueCapabilityGate, dispatchGlueAttachment, GlueCapabilityDeniedError } from '../index.js';

// The inherited public glue functions already comply; pin delegate forwarding.
test('capability delegates preserve the separate required and optional objects', () => {
  const calls: unknown[] = [];
  const required = { itemId: 'example' }, optional = { verbose: true };
  const gate = buildGlueCapabilityGate({ moduleId: 'module', vocabulary: ['read', 'write'], capabilities: ['read'], coreDelegates: {
    read: (args, options) => { calls.push([args, options]); return 'read'; },
  } }, {});
  assert.equal(gate.read!(required, optional), 'read');
  assert.equal((calls[0] as unknown[])[0], required);
  assert.equal((calls[0] as unknown[])[1], optional);
  assert.throws(() => gate.write!({}), GlueCapabilityDeniedError);
  const error = new GlueCapabilityDeniedError({ moduleId: 'module', capability: 'write' });
  assert.equal(error.moduleId, 'module');
  assert.equal(error.capability, 'write');
});

test('attachment dispatch passes host dependencies and arguments as objects', () => {
  const calls: unknown[] = [];
  const input = { moduleId: 'module', callSite: 'render', payload: { itemId: 'example' },
    dispatch: (required: { moduleId: string; callSite: string; payload: Readonly<Record<string, unknown>> }) => { calls.push(required); return 17; },
  };
  assert.deepEqual(dispatchGlueAttachment({ ...input, wiredCallSites: ['render'] }), { wired: true, result: 17 });
  assert.deepEqual(calls, [{ moduleId: 'module', callSite: 'render', payload: input.payload }]);
  assert.deepEqual(dispatchGlueAttachment({ ...input, wiredCallSites: [] }), { wired: false, code: 'UNWIRED_CALL_SITE' });
  assert.equal(calls.length, 1);
});



