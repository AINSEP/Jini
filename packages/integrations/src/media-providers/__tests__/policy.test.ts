import { describe, expect, it } from 'vitest';
import { createAllowlistMediaPolicy, DEFAULT_MEDIA_EXECUTION_POLICY } from '../policy.js';

describe('createAllowlistMediaPolicy', () => {
  it('SEC-RB-010: defaults to disabled (deny by default) when constructed with no argument', () => {
    const policy = createAllowlistMediaPolicy();
    expect(policy.evaluate({ surface: 'image' })?.code).toBe('MEDIA_EXECUTION_DISABLED');
    expect(policy.evaluate({ surface: 'video', model: 'anything' })?.code).toBe('MEDIA_EXECUTION_DISABLED');
  });

  it('DEFAULT_MEDIA_EXECUTION_POLICY is mode: disabled with no allowlists', () => {
    expect(DEFAULT_MEDIA_EXECUTION_POLICY).toEqual({ mode: 'disabled' });
  });

  it('denies everything when mode is disabled', () => {
    const policy = createAllowlistMediaPolicy({ mode: 'disabled' });
    expect(policy.evaluate({ surface: 'image' })).toEqual({
      code: 'MEDIA_EXECUTION_DISABLED',
      message: 'media generation is disabled for this run',
    });
  });

  it('denies a surface not in allowedSurfaces', () => {
    const policy = createAllowlistMediaPolicy({ mode: 'enabled', allowedSurfaces: ['image'] });
    expect(policy.evaluate({ surface: 'video' })).toEqual({
      code: 'MEDIA_SURFACE_DENIED',
      message: 'media surface "video" is not allowed for this run',
    });
    expect(policy.evaluate({ surface: 'image' })).toBeNull();
  });

  it('an empty allowedSurfaces array means unrestricted (matches origin semantics)', () => {
    const policy = createAllowlistMediaPolicy({ mode: 'enabled', allowedSurfaces: [] });
    expect(policy.evaluate({ surface: 'video' })).toBeNull();
  });

  it('denies a model not in allowedModels', () => {
    const policy = createAllowlistMediaPolicy({ mode: 'enabled', allowedModels: ['sora-2'] });
    expect(policy.evaluate({ surface: 'video', model: 'veo-3' })).toEqual({
      code: 'MEDIA_MODEL_DENIED',
      message: 'media model "veo-3" is not allowed for this run',
    });
    expect(policy.evaluate({ surface: 'video', model: 'sora-2' })).toBeNull();
  });

  it('SEC-RB-010: denies (does not bypass) allowedModels when the target has no model', () => {
    const policy = createAllowlistMediaPolicy({ mode: 'enabled', allowedModels: ['sora-2'] });
    expect(policy.evaluate({ surface: 'video' })).toEqual({
      code: 'MEDIA_MODEL_DENIED',
      message: 'media model (none specified) is not allowed for this run',
    });
  });

  it('SEC-RB-010: denies allowedModels when the target model is blank/whitespace-only after normalization', () => {
    const policy = createAllowlistMediaPolicy({ mode: 'enabled', allowedModels: ['sora-2'] });
    expect(policy.evaluate({ surface: 'video', model: '   ' })?.code).toBe('MEDIA_MODEL_DENIED');
  });

  it('trims a model before comparing it against allowedModels', () => {
    const policy = createAllowlistMediaPolicy({ mode: 'enabled', allowedModels: ['sora-2'] });
    expect(policy.evaluate({ surface: 'video', model: '  sora-2  ' })).toBeNull();
  });

  it('an empty allowedModels array means unrestricted', () => {
    const policy = createAllowlistMediaPolicy({ mode: 'enabled', allowedModels: [] });
    expect(policy.evaluate({ surface: 'video', model: 'anything' })).toBeNull();
  });

  it('mode: disabled short-circuits before surface/model checks', () => {
    const policy = createAllowlistMediaPolicy({ mode: 'disabled', allowedSurfaces: ['image'], allowedModels: ['sora-2'] });
    expect(policy.evaluate({ surface: 'image', model: 'sora-2' })?.code).toBe('MEDIA_EXECUTION_DISABLED');
  });
});
