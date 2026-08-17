import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';

describe('@jini-ai/integrations/media-providers barrel completeness', () => {
  it('re-exports the capability-registry surface', () => {
    expect(barrel.createCapabilityRegistry).toBeTypeOf('function');
    expect(barrel.normalizeModelId).toBeTypeOf('function');
  });

  it('re-exports the provider catalogue', () => {
    expect(barrel.MEDIA_PROVIDERS.length).toBeGreaterThan(0);
    expect(barrel.findMediaModel).toBeTypeOf('function');
    expect(barrel.findProvider).toBeTypeOf('function');
    expect(barrel.modelsForSurface).toBeTypeOf('function');
  });

  it('re-exports the reference capability seed', () => {
    expect(barrel.MEDIA_CAPABILITY_SEED.length).toBeGreaterThan(0);
  });

  it('re-exports the video-request builder', () => {
    expect(barrel.buildVideoRequest).toBeTypeOf('function');
    expect(barrel.normalizeVideoResponse).toBeTypeOf('function');
  });

  it('re-exports the task store', () => {
    expect(barrel.createInMemoryMediaTaskStore).toBeTypeOf('function');
  });

  it('re-exports the policy port', () => {
    expect(barrel.createAllowlistMediaPolicy).toBeTypeOf('function');
    expect(barrel.DEFAULT_MEDIA_EXECUTION_POLICY).toEqual({ mode: 'disabled' });
  });

  it('re-exports the staging port', () => {
    expect(barrel.createFsAttachmentStaging).toBeTypeOf('function');
  });

  it('re-exports the tokens', () => {
    expect(barrel.CapabilityRegistryToken.id).toBe('jini.media.capabilityRegistry');
    expect(barrel.MediaTaskStoreToken.id).toBe('jini.media.taskStore');
    expect(barrel.MediaPolicyToken.id).toBe('jini.media.policy');
  });

  it('re-exports the dispatch engine', () => {
    expect(barrel.createMediaDispatchEngine).toBeTypeOf('function');
    expect(barrel.resolveProviderCredentialsFromEnv).toBeTypeOf('function');
    expect(barrel.renderStub).toBeTypeOf('function');
    expect(barrel.buildRenderContext).toBeTypeOf('function');
  });
});
