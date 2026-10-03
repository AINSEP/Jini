import assert from 'node:assert/strict';
import { test } from 'vitest';
import { validateGlueManifest, dispatchGlueAttachment, buildGlueCapabilityGate, GlueCapabilityDeniedError, mergeGlueToolRegistrations } from '../index.js';

test('alternate vocabulary changes validation without changing source', () => {
  const manifest = { id: 'module', version: '1', sdkRange: '*', capabilities: ['tenant.read'], attachments: [{ callSite: 'tenant.loaded' }] };
  const baseline = validateGlueManifest({ manifest, vocabulary: { capabilities: ['document.read'], callSites: ['document.loaded'] } });
  const treatment = validateGlueManifest({ manifest, vocabulary: { capabilities: ['tenant.read'], callSites: ['tenant.loaded'] } });
  assert.deepEqual(baseline.errors.map(e => e.code), ['CAPABILITY_UNKNOWN', 'CALL_SITE_UNKNOWN']);
  assert.deepEqual(treatment.errors, []);
});

test('wired call-site data controls whether the injected dispatcher executes', () => {
  const calls: unknown[] = [];
  const input = { moduleId: 'm', callSite: 'tenant.loaded', payload: { tenant: 1 }, dispatch: (value: unknown) => { calls.push(value); return 'handled'; } };
  assert.deepEqual(dispatchGlueAttachment({ ...input, wiredCallSites: [] }), { wired: false, code: 'UNWIRED_CALL_SITE' });
  assert.deepEqual(calls, []);
  assert.deepEqual(dispatchGlueAttachment({ ...input, wiredCallSites: ['tenant.loaded'] }), { wired: true, result: 'handled' });
  assert.deepEqual(calls, [{ moduleId: 'm', callSite: 'tenant.loaded', payload: { tenant: 1 } }]);
});

test('missing delegates fail closed and prototype names cannot escape the grant gate', () => {
  const gate = buildGlueCapabilityGate({ moduleId: 'm', vocabulary: ['__proto__', 'constructor', 'missing'], capabilities: ['constructor', 'missing'], coreDelegates: {} });
  assert.equal(Object.getPrototypeOf(gate), null);
  assert.throws(() => gate['__proto__']!({}), GlueCapabilityDeniedError);
  assert.throws(() => gate['constructor']!({}), GlueCapabilityDeniedError);
  assert.throws(() => gate['missing']!({}), GlueCapabilityDeniedError);
});

test('duplicate tool IDs within one module quarantine it before any host mount', () => {
  let mounts = 0;
  const result = mergeGlueToolRegistrations({ coreToolIds: [], glueModules: [{ moduleId: 'm', build: () => [{ toolId: 'same', handler: () => 1 }, { toolId: 'same', handler: () => 2 }] }], hostPort: { registerTools: () => { mounts++; } } });
  assert.deepEqual(result.registeredModuleIds, []);
  assert.equal(result.quarantined[0]!.reason, 'DUPLICATE_TOOL_ID'); assert.equal(mounts, 0);
});
