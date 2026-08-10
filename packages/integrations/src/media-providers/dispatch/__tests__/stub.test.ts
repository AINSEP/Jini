import { describe, expect, it } from 'vitest';
import { renderStub, svgPlaceholder } from '../stub.js';
import type { RenderContext } from '../types.js';

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    surface: 'image',
    model: 'unreleased-model',
    wireModel: 'unreleased-model',
    prompt: 'a red bicycle',
    aspect: '1:1',
    length: undefined,
    duration: undefined,
    voice: '',
    audioKind: undefined,
    language: '',
    loop: false,
    promptInfluence: undefined,
    imageRef: null,
    imageRefs: [],
    requestInit: {},
    speechFormat: 'mp3',
    onProgress: undefined,
    ...overrides,
  };
}

describe('renderStub', () => {
  it('returns a 1x1 PNG placeholder for the image surface', async () => {
    const result = await renderStub(baseCtx(), 'some-provider', true);
    expect(result.suggestedExt).toBe('.png');
    // PNG magic bytes
    expect(result.bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(result.providerNote).toContain('stub-image');
  });

  it('notes "integration pending" when the provider is not integrated', async () => {
    const result = await renderStub(baseCtx(), 'unintegrated-vendor', false);
    expect(result.providerNote).toContain("provider 'unintegrated-vendor' integration pending");
  });

  it('returns minimal MP4 container bytes for the video surface', async () => {
    const result = await renderStub(baseCtx({ surface: 'video', length: 8 }), 'p', true);
    expect(result.suggestedExt).toBe('.mp4');
    expect(result.providerNote).toContain('length=8s');
  });

  it('notes length=?s when no length was requested', async () => {
    const result = await renderStub(baseCtx({ surface: 'video', length: undefined }), 'p', true);
    expect(result.providerNote).toContain('length=?s');
  });

  it('returns silent WAV bytes when speechFormat is wav', async () => {
    const result = await renderStub(baseCtx({ surface: 'audio', audioKind: 'speech', speechFormat: 'wav', duration: 5 }), 'p', true);
    expect(result.suggestedExt).toBe('.wav');
    expect(result.bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(result.providerNote).toContain('duration=5s');
  });

  it('notes duration=?s for the wav stub when no duration was requested', async () => {
    const result = await renderStub(baseCtx({ surface: 'audio', audioKind: 'speech', speechFormat: 'wav', duration: undefined }), 'p', true);
    expect(result.providerNote).toContain('duration=?s');
  });

  it('returns mp3 bytes by default for the audio surface', async () => {
    const result = await renderStub(baseCtx({ surface: 'audio', audioKind: 'music', voice: 'nova' }), 'p', true);
    expect(result.suggestedExt).toBe('.mp3');
    expect(result.providerNote).toContain('voice=nova');
  });

  it('notes voice=- and duration=?s for the mp3 stub when neither was requested', async () => {
    const result = await renderStub(baseCtx({ surface: 'audio', audioKind: 'music', voice: '', duration: undefined }), 'p', true);
    expect(result.providerNote).toContain('voice=-');
    expect(result.providerNote).toContain('duration=?s');
  });
});

describe('svgPlaceholder', () => {
  it('renders a valid SVG containing the model and prompt, HTML-escaped', () => {
    const svg = svgPlaceholder(baseCtx({ model: '<model>', prompt: 'a & b' }));
    expect(svg).toContain('<svg');
    expect(svg).toContain('&lt;model&gt;');
    expect(svg).toContain('a &amp; b');
    expect(svg).not.toContain('<model>');
  });

  it('renders an empty label segment for a blank prompt rather than the literal string "false"/"undefined"', () => {
    const svg = svgPlaceholder(baseCtx({ prompt: '' }));
    expect(svg).toContain('>unreleased-model — <');
  });

  it('sizes a square box for a 1:1 aspect, a wide box for 16:9, and a tall box for 9:16', () => {
    const square = svgPlaceholder(baseCtx({ aspect: '1:1' }));
    expect(square).toContain('width="800" height="800"');
    const wide = svgPlaceholder(baseCtx({ aspect: '16:9' }));
    expect(wide).toContain('width="800" height="450"');
    const tall = svgPlaceholder(baseCtx({ aspect: '9:16' }));
    expect(tall).toContain('width="450" height="800"');
  });

  it('defaults to a square box for a missing or unparseable aspect', () => {
    const missing = svgPlaceholder(baseCtx({ aspect: undefined }));
    expect(missing).toContain('width="800" height="800"');
    const garbage = svgPlaceholder(baseCtx({ aspect: 'not-an-aspect' }));
    expect(garbage).toContain('width="800" height="800"');
  });
});
