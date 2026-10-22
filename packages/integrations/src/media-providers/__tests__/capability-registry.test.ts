import { describe, expect, it } from 'vitest';
import { createCapabilityRegistry, normalizeModelId } from '../capability-registry.js';
import type { ModelCapability } from '../types.js';

const CAP_A: ModelCapability = { id: 'model-a', apiModel: 'model-a-wire', mediaType: 'video', caps: ['t2v'] };
const CAP_B: ModelCapability = { id: 'model-b', apiModel: 'model-b-wire', mediaType: 'image', caps: ['t2i'] };

describe('normalizeModelId', () => {
    it('strips a leading aihubmix- prefix', () => {
        expect(normalizeModelId({ id: 'aihubmix-gpt-image-1' })).toBe('gpt-image-1');
    });
    it('trims whitespace', () => {
        expect(normalizeModelId({ id: '  model-a  ' })).toBe('model-a');
    });
    it('handles an empty/undefined-ish id gracefully', () => {
        expect(normalizeModelId({ id: '' })).toBe('');
    });
});

describe('createCapabilityRegistry', () => {
    it('starts empty with no seed', () => {
        const registry = createCapabilityRegistry({});
        expect(registry.all()).toEqual([]);
        expect(registry.get({ id: 'model-a' })).toBeUndefined();
    });
    it('is seeded and retrievable by id', () => {
        const registry = createCapabilityRegistry({}, { seed: [CAP_A, CAP_B] });
        expect(registry.get({ id: 'model-a' })).toEqual(CAP_A);
        expect(registry.all()).toHaveLength(2);
    });
    it('get() normalizes an aihubmix- prefixed lookup id', () => {
        const registry = createCapabilityRegistry({}, { seed: [CAP_A] });
        expect(registry.get({ id: 'aihubmix-model-a' })).toEqual(CAP_A);
    });
    it('register() adds new capabilities and overrides duplicates by id', () => {
        const registry = createCapabilityRegistry({}, { seed: [CAP_A] });
        const updatedA: ModelCapability = { ...CAP_A, caps: ['t2v', 'i2v'] };
        registry.register({ caps: [updatedA, CAP_B] });
        expect(registry.all()).toHaveLength(2);
        expect(registry.get({ id: 'model-a' })).toEqual(updatedA);
    });
    it('register() skips malformed entries (no id, empty id, or non-string id)', () => {
        const registry = createCapabilityRegistry({});
        registry.register({ caps: [
                    { ...CAP_A, id: '' },
                    { ...CAP_A, id: undefined as unknown as string },
                    null as unknown as ModelCapability,
                ] });
        expect(registry.all()).toEqual([]);
    });
});
