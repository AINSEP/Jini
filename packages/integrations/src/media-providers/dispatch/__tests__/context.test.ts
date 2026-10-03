import { describe, expect, it } from 'vitest';
import { buildRenderContext } from '../context.js';
import type { MediaGenerationRequest } from '../types.js';

function baseRequest(overrides: Partial<MediaGenerationRequest> = {}): MediaGenerationRequest {
  return { surface: 'image', model: 'gpt-image-2', ...overrides };
}

describe('buildRenderContext', () => {
    it('defaults wireModel to model when not supplied, and honors an explicit override', () => {
        expect(buildRenderContext({ request: baseRequest(), resolvedAudioKind: undefined, length: undefined, duration: undefined }).wireModel).toBe('gpt-image-2');
        expect(buildRenderContext({ request: baseRequest({ wireModel: 'my-alias' }), resolvedAudioKind: undefined, length: undefined, duration: undefined }).wireModel).toBe('my-alias');
    });
    it('defaults aspect per surface when not supplied, and honors an explicit override', () => {
        expect(buildRenderContext({ request: baseRequest({ surface: 'image' }), resolvedAudioKind: undefined, length: undefined, duration: undefined }).aspect).toBe('1:1');
        expect(buildRenderContext({ request: baseRequest({ surface: 'video' }), resolvedAudioKind: undefined, length: undefined, duration: undefined }).aspect).toBe('16:9');
        expect(buildRenderContext({ request: baseRequest({ surface: 'audio' }), resolvedAudioKind: undefined, length: undefined, duration: undefined }).aspect).toBeUndefined();
        expect(buildRenderContext({ request: baseRequest({ aspect: '4:3' }), resolvedAudioKind: undefined, length: undefined, duration: undefined }).aspect).toBe('4:3');
    });
    it('defaults prompt/voice/language to empty strings when omitted', () => {
        const ctx = buildRenderContext({ request: baseRequest(), resolvedAudioKind: undefined, length: undefined, duration: undefined });
        expect(ctx.prompt).toBe('');
        expect(ctx.voice).toBe('');
        expect(ctx.language).toBe('');
    });
    it('passes through prompt/voice/language when supplied', () => {
        const ctx = buildRenderContext({ request: baseRequest({ prompt: 'a cat', voice: 'nova', language: 'en' }), resolvedAudioKind: undefined, length: undefined, duration: undefined });
        expect(ctx.prompt).toBe('a cat');
        expect(ctx.voice).toBe('nova');
        expect(ctx.language).toBe('en');
    });
    it('threads the already-clamped length/duration through unchanged', () => {
        const ctx = buildRenderContext({ request: baseRequest(), resolvedAudioKind: undefined, length: 8, duration: undefined });
        expect(ctx.length).toBe(8);
        expect(ctx.duration).toBeUndefined();
    });
    it('normalizes loop to a strict boolean', () => {
        expect(buildRenderContext({ request: baseRequest({ loop: true }), resolvedAudioKind: undefined, length: undefined, duration: undefined }).loop).toBe(true);
        expect(buildRenderContext({ request: baseRequest(), resolvedAudioKind: undefined, length: undefined, duration: undefined }).loop).toBe(false);
        expect(buildRenderContext({ request: baseRequest({ loop: false }), resolvedAudioKind: undefined, length: undefined, duration: undefined }).loop).toBe(false);
    });
    it('resolves speechFormat via resolveSpeechFormat (defaults to mp3)', () => {
        expect(buildRenderContext({ request: baseRequest(), resolvedAudioKind: undefined, length: undefined, duration: undefined }).speechFormat).toBe('mp3');
        expect(buildRenderContext({ request: baseRequest({ speechFormat: 'wav' }), resolvedAudioKind: undefined, length: undefined, duration: undefined }).speechFormat).toBe('wav');
    });
    describe('promptInfluence', () => {
        it('passes through a valid finite number', () => {
            expect(buildRenderContext({ request: baseRequest({ promptInfluence: 0.7 }), resolvedAudioKind: undefined, length: undefined, duration: undefined }).promptInfluence).toBe(0.7);
        });
        it('is undefined when omitted', () => {
            expect(buildRenderContext({ request: baseRequest(), resolvedAudioKind: undefined, length: undefined, duration: undefined }).promptInfluence).toBeUndefined();
        });
        it('is undefined for NaN or Infinity (never forwards a non-finite number to a provider)', () => {
            expect(buildRenderContext({ request: baseRequest({ promptInfluence: Number.NaN }), resolvedAudioKind: undefined, length: undefined, duration: undefined }).promptInfluence).toBeUndefined();
            expect(buildRenderContext({ request: baseRequest({ promptInfluence: Number.POSITIVE_INFINITY }), resolvedAudioKind: undefined, length: undefined, duration: undefined }).promptInfluence).toBeUndefined();
        });
    });
    describe('imageRef / imageRefs', () => {
        it('imageRef defaults to null when omitted, and passes through when supplied', () => {
            expect(buildRenderContext({ request: baseRequest(), resolvedAudioKind: undefined, length: undefined, duration: undefined }).imageRef).toBeNull();
            const ref = { dataUrl: 'data:image/png;base64,AAA=' };
            expect(buildRenderContext({ request: baseRequest({ imageRef: ref }), resolvedAudioKind: undefined, length: undefined, duration: undefined }).imageRef).toEqual(ref);
        });
        it('imageRefs defaults to [] when neither imageRef nor imageRefs is supplied', () => {
            expect(buildRenderContext({ request: baseRequest(), resolvedAudioKind: undefined, length: undefined, duration: undefined }).imageRefs).toEqual([]);
        });
        it('imageRefs derives a single-element array from imageRef when imageRefs is omitted', () => {
            const ref = { dataUrl: 'data:image/png;base64,AAA=' };
            expect(buildRenderContext({ request: baseRequest({ imageRef: ref }), resolvedAudioKind: undefined, length: undefined, duration: undefined }).imageRefs).toEqual([ref]);
        });
        it('an explicit imageRefs array wins over deriving one from imageRef', () => {
            const primary = { dataUrl: 'data:image/png;base64,PRIMARY=' };
            const explicit = [{ dataUrl: 'data:image/png;base64,A=' }, { dataUrl: 'data:image/png;base64,B=' }];
            const ctx = buildRenderContext({ request: baseRequest({ imageRef: primary, imageRefs: explicit }), resolvedAudioKind: undefined, length: undefined, duration: undefined });
            expect(ctx.imageRefs).toBe(explicit);
        });
    });
});
