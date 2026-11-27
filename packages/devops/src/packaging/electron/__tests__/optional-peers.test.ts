import assert from 'node:assert/strict';
import { test } from 'vitest';
import { optionalPeerClassification, optionalPeerContractProblems } from '../optional-peers.js';

test('requires actionable opt-in help for every optional peer, including one already installed', () => {
  const manifest = {
    dependencies: { telemetry: '1.0.0' },
    peerDependencies: { telemetry: '^1', reporter: '^2', runner: '^3', required: '^1' },
    peerDependenciesMeta: { telemetry: { optional: true }, reporter: { optional: true }, runner: { optional: true }, required: { optional: false } },
    jini: { optionalPeers: { telemetry: 'Integration is disabled by default', runner: 'opt-in: Jobs — Install runner to start jobs.', required: 'opt-in: Logs – Install required to see logs.' } },
  };
  assert.deepEqual(optionalPeerContractProblems({ manifest }), [
    'unclassified optional peer telemetry; declare jini.optionalPeers with opt-in feature and user-facing message, or make it required',
    'unclassified optional peer reporter; declare jini.optionalPeers with opt-in feature and user-facing message, or make it required',
  ]);
  assert.equal(optionalPeerClassification({ manifest, name: 'runner' }), 'opt-in: Jobs — Install runner to start jobs.');
  assert.equal(optionalPeerClassification({ manifest, name: 'required' }), undefined);
  assert.deepEqual(optionalPeerContractProblems({ manifest: { peerDependencies: { required: '^1' } } }), []);
});
