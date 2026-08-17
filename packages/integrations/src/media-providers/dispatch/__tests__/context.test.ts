import { describe, expect, it } from 'vitest';
import { buildRenderContext } from '../context.js';
import type { MediaGenerationRequest } from '../types.js';

function baseRequest(overrides: Partial<MediaGenerationRequest> = {}): MediaGenerationRequest {
  return { surface: 'image', model: 'gpt-image-2', ...overrides };
}

describe('buildRenderContext', () => {
  it('defaults wireModel to model when not supplied, and honors an explicit override', () => {
    expect(buildRenderContext(baseRequest(), undefined, undefined, undefined).wireModel).toBe('gpt-image-2');
    expect(buildRenderContext(baseRequest({ wireModel: 'my-alias' }), undefined, undefined, undefined).wireModel).toBe('my-alias');
  });

  it('defaults aspect per surface when not supplied, and honors an explicit override', () => {
    expect(buildRenderContext(baseRequest({ surface: 'image' }), undefined, undefined, undefined).aspect).toBe('1:1');
    expect(buildRenderContext(baseRequest({ surface: 'video' }), undefined, undefined, undefined).aspect).toBe('16:9');
    expect(buildRenderContext(baseRequest({ surface: 'audio' }), undefined, undefined, undefined).aspect).toBeUndefined();
    expect(buildRenderContext(baseRequest({ aspect: '4:3' }), undefined, undefined, undefined).aspect).toBe('4:3');
  });

  it('defaults prompt/voice/language to empty strings when omitted', () => {
    const ctx = buildRenderContext(baseRequest(), undefined, undefined, undefined);
    expect(ctx.prompt).toBe('');
    expect(ctx.voice).toBe('');
    expect(ctx.language).toBe('');
  });

  it('passes through prompt/voice/language when supplied', () => {
    const ctx = buildRenderContext(baseRequest({ prompt: 'a cat', voice: 'nova', language: 'en' }), undefined, undefined, undefined);
    expect(ctx.prompt).toBe('a cat');
    expect(ctx.voice).toBe('nova');
    expect(ctx.language).toBe('en');
  });

  it('threads the already-clamped length/duration through unchanged', () => {
    const ctx = buildRenderContext(baseRequest(), undefined, 8, undefined);
    expect(ctx.length).toBe(8);
    expect(ctx.duration).toBeUndefined();
  });

  it('normalizes loop to a strict boolean', () => {
    expect(buildRenderContext(baseRequest({ loop: true }), undefined, undefined, undefined).loop).toBe(true);
    expect(buildRenderContext(baseRequest(), undefined, undefined, undefined).loop).toBe(false);
    expect(buildRenderContext(baseRequest({ loop: false }), undefined, undefined, undefined).loop).toBe(false);
  });

  it('resolves speechFormat via resolveSpeechFormat (defaults to mp3)', () => {
    expect(buildRenderContext(baseRequest(), undefined, undefined, undefined).speechFormat).toBe('mp3');
    expect(buildRenderContext(baseRequest({ speechFormat: 'wav' }), undefined, undefined, undefined).speechFormat).toBe('wav');
  });

  describe('promptInfluence', () => {
    it('passes through a valid finite number', () => {
      expect(buildRenderContext(baseRequest({ promptInfluence: 0.7 }), undefined, undefined, undefined).promptInfluence).toBe(0.7);
    });

    it('is undefined when omitted', () => {
      expect(buildRenderContext(baseRequest(), undefined, undefined, undefined).promptInfluence).toBeUndefined();
    });

    it('is undefined for NaN or Infinity (never forwards a non-finite number to a provider)', () => {
      expect(buildRenderContext(baseRequest({ promptInfluence: Number.NaN }), undefined, undefined, undefined).promptInfluence).toBeUndefined();
      expect(buildRenderContext(baseRequest({ promptInfluence: Number.POSITIVE_INFINITY }), undefined, undefined, undefined).promptInfluence).toBeUndefined();
    });
  });

  describe('imageRef / imageRefs', () => {
    it('imageRef defaults to null when omitted, and passes through when supplied', () => {
      expect(buildRenderContext(baseRequest(), undefined, undefined, undefined).imageRef).toBeNull();
      const ref = { dataUrl: 'data:image/png;base64,AAA=' };
      expect(buildRenderContext(baseRequest({ imageRef: ref }), undefined, undefined, undefined).imageRef).toEqual(ref);
    });

    it('imageRefs defaults to [] when neither imageRef nor imageRefs is supplied', () => {
      expect(buildRenderContext(baseRequest(), undefined, undefined, undefined).imageRefs).toEqual([]);
    });

    it('imageRefs derives a single-element array from imageRef when imageRefs is omitted', () => {
      const ref = { dataUrl: 'data:image/png;base64,AAA=' };
      expect(buildRenderContext(baseRequest({ imageRef: ref }), undefined, undefined, undefined).imageRefs).toEqual([ref]);
    });

    it('an explicit imageRefs array wins over deriving one from imageRef', () => {
      const primary = { dataUrl: 'data:image/png;base64,PRIMARY=' };
      const explicit = [{ dataUrl: 'data:image/png;base64,A=' }, { dataUrl: 'data:image/png;base64,B=' }];
      const ctx = buildRenderContext(baseRequest({ imageRef: primary, imageRefs: explicit }), undefined, undefined, undefined);
      expect(ctx.imageRefs).toBe(explicit);
    });
  });
});
