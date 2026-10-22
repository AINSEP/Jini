import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildGlueCapabilityGate, GlueCapabilityDeniedError, type GlueCapabilityDelegate } from '../capability-gate.js';

test('granted capabilities require an explicitly owned delegate, including prototype names', () => {
  const inherited: Record<string, GlueCapabilityDelegate> = Object.create({
    'tenant.read': () => { throw new Error('an inherited delegate must never execute'); },
  }) as Record<string, GlueCapabilityDelegate>;
  const gate = buildGlueCapabilityGate({
    moduleId: 'extension', vocabulary: ['tenant.read', 'constructor', 'toString'],
    capabilities: ['tenant.read', 'constructor', 'toString'], coreDelegates: inherited,
  });
  for (const capability of ['tenant.read', 'constructor', 'toString']) {
    assert.throws(() => gate[capability]!({}), (error: unknown) => {
      assert.ok(error instanceof GlueCapabilityDeniedError);
      assert.equal(error.moduleId, 'extension');
      assert.equal(error.capability, capability);
      return true;
    });
  }
});

test('a declared own delegate receives both argument objects and keeps its snapshotted reference', () => {
  const required = Object.freeze({ tenantId: 'tenant-a' });
  const optional = Object.freeze({ includeArchived: true });
  const calls: unknown[][] = [];
  const original: GlueCapabilityDelegate = (args, options) => {
    calls.push([args, options]);
    return 'original-result';
  };
  const delegates = { 'tenant.read': original };
  const gate = buildGlueCapabilityGate({
    moduleId: 'extension', vocabulary: ['tenant.read'],
    capabilities: ['tenant.read'], coreDelegates: delegates,
  });
  delegates['tenant.read'] = () => 'replacement-result';
  assert.equal(gate['tenant.read']!(required, optional), 'original-result');
  assert.deepEqual(calls, [[required, optional]]);
});

