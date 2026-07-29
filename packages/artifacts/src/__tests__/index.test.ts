import { describe, expect, it } from 'vitest';
import * as artifacts from '../index.js';
import * as artifactsNode from '../node/index.js';

describe('artifacts barrel', () => {
  it('re-exports the public surface of every artifacts module', () => {
    expect(typeof artifacts.validateArtifactManifestInput).toBe('function');
    expect(typeof artifacts.createInMemoryArtifactStore).toBe('function');
    expect(typeof artifacts.assertArtifactPublicationAllowed).toBe('function');
    expect(typeof artifacts.noopRuntimeCompatNormalizer).toBe('function');
    expect(typeof artifacts.classifyArtifactStubGuard).toBe('function');
    expect(typeof artifacts.createXmlTagTextSuppressor).toBe('function');
  });

  it('does NOT export the disk-backed stub guard — that lives at ./node (this entry point is runtime-universal)', () => {
    // Split 2026-07-29: node:fs/node:path stayed confined to the separate
    // @jini-ai/artifacts/node entry point specifically so this root barrel
    // never forces a resolver to touch them. Confirmed absent here rather
    // than assumed.
    expect((artifacts as Record<string, unknown>).findPriorArtifactSiblings).toBeUndefined();
    expect((artifacts as Record<string, unknown>).evaluateArtifactStubGuard).toBeUndefined();
  });
});

describe('artifacts/node barrel', () => {
  it('re-exports the disk-backed stub guard', () => {
    expect(typeof artifactsNode.findPriorArtifactSiblings).toBe('function');
    expect(typeof artifactsNode.evaluateArtifactStubGuard).toBe('function');
  });
});
