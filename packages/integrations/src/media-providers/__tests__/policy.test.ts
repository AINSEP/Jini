import { partitionArgs } from '../../args.js';
import { describe, expect, it } from 'vitest';
import { createAllowlistMediaPolicy, DEFAULT_MEDIA_EXECUTION_POLICY } from '../policy.js';
import type { MediaExecutionPolicy, MediaPolicyTarget } from '../policy.js';

describe('createAllowlistMediaPolicy', () => {
    it('SEC-RB-010: defaults to disabled (deny by default) when constructed with no argument', () => {
        const policy = createAllowlistMediaPolicy(...partitionArgs({}, []));
        expect(policy.evaluate(...partitionArgs({ surface: 'image' } satisfies MediaPolicyTarget, ["surface"]))?.code).toBe('MEDIA_EXECUTION_DISABLED');
        expect(policy.evaluate(...partitionArgs({ surface: 'video', model: 'anything' } satisfies MediaPolicyTarget, ["surface"]))?.code).toBe('MEDIA_EXECUTION_DISABLED');
    });
    it('DEFAULT_MEDIA_EXECUTION_POLICY is mode: disabled with no allowlists', () => {
        expect(DEFAULT_MEDIA_EXECUTION_POLICY).toEqual({ mode: 'disabled' });
    });
    it('denies everything when mode is disabled', () => {
        const policy = createAllowlistMediaPolicy(...partitionArgs({ mode: 'disabled' } satisfies Partial<MediaExecutionPolicy>, []));
        expect(policy.evaluate(...partitionArgs({ surface: 'image' } satisfies MediaPolicyTarget, ["surface"]))).toEqual({
            code: 'MEDIA_EXECUTION_DISABLED',
            message: 'media generation is disabled for this run',
        });
    });
    it('denies a surface not in allowedSurfaces', () => {
        const policy = createAllowlistMediaPolicy(...partitionArgs({ mode: 'enabled', allowedSurfaces: ['image'] } satisfies Partial<MediaExecutionPolicy>, []));
        expect(policy.evaluate(...partitionArgs({ surface: 'video' } satisfies MediaPolicyTarget, ["surface"]))).toEqual({
            code: 'MEDIA_SURFACE_DENIED',
            message: 'media surface "video" is not allowed for this run',
        });
        expect(policy.evaluate(...partitionArgs({ surface: 'image' } satisfies MediaPolicyTarget, ["surface"]))).toBeNull();
    });
    it('an empty allowedSurfaces array means unrestricted (matches origin semantics)', () => {
        const policy = createAllowlistMediaPolicy(...partitionArgs({ mode: 'enabled', allowedSurfaces: [] } satisfies Partial<MediaExecutionPolicy>, []));
        expect(policy.evaluate(...partitionArgs({ surface: 'video' } satisfies MediaPolicyTarget, ["surface"]))).toBeNull();
    });
    it('denies a model not in allowedModels', () => {
        const policy = createAllowlistMediaPolicy(...partitionArgs({ mode: 'enabled', allowedModels: ['sora-2'] } satisfies Partial<MediaExecutionPolicy>, []));
        expect(policy.evaluate(...partitionArgs({ surface: 'video', model: 'veo-3' } satisfies MediaPolicyTarget, ["surface"]))).toEqual({
            code: 'MEDIA_MODEL_DENIED',
            message: 'media model "veo-3" is not allowed for this run',
        });
        expect(policy.evaluate(...partitionArgs({ surface: 'video', model: 'sora-2' } satisfies MediaPolicyTarget, ["surface"]))).toBeNull();
    });
    it('SEC-RB-010: denies (does not bypass) allowedModels when the target has no model', () => {
        const policy = createAllowlistMediaPolicy(...partitionArgs({ mode: 'enabled', allowedModels: ['sora-2'] } satisfies Partial<MediaExecutionPolicy>, []));
        expect(policy.evaluate(...partitionArgs({ surface: 'video' } satisfies MediaPolicyTarget, ["surface"]))).toEqual({
            code: 'MEDIA_MODEL_DENIED',
            message: 'media model (none specified) is not allowed for this run',
        });
    });
    it('SEC-RB-010: denies allowedModels when the target model is blank/whitespace-only after normalization', () => {
        const policy = createAllowlistMediaPolicy(...partitionArgs({ mode: 'enabled', allowedModels: ['sora-2'] } satisfies Partial<MediaExecutionPolicy>, []));
        expect(policy.evaluate(...partitionArgs({ surface: 'video', model: '   ' } satisfies MediaPolicyTarget, ["surface"]))?.code).toBe('MEDIA_MODEL_DENIED');
    });
    it('trims a model before comparing it against allowedModels', () => {
        const policy = createAllowlistMediaPolicy(...partitionArgs({ mode: 'enabled', allowedModels: ['sora-2'] } satisfies Partial<MediaExecutionPolicy>, []));
        expect(policy.evaluate(...partitionArgs({ surface: 'video', model: '  sora-2  ' } satisfies MediaPolicyTarget, ["surface"]))).toBeNull();
    });
    it('an empty allowedModels array means unrestricted', () => {
        const policy = createAllowlistMediaPolicy(...partitionArgs({ mode: 'enabled', allowedModels: [] } satisfies Partial<MediaExecutionPolicy>, []));
        expect(policy.evaluate(...partitionArgs({ surface: 'video', model: 'anything' } satisfies MediaPolicyTarget, ["surface"]))).toBeNull();
    });
    it('mode: disabled short-circuits before surface/model checks', () => {
        const policy = createAllowlistMediaPolicy(...partitionArgs({ mode: 'disabled', allowedSurfaces: ['image'], allowedModels: ['sora-2'] } satisfies Partial<MediaExecutionPolicy>, []));
        expect(policy.evaluate(...partitionArgs({ surface: 'image', model: 'sora-2' } satisfies MediaPolicyTarget, ["surface"]))?.code).toBe('MEDIA_EXECUTION_DISABLED');
    });
});
