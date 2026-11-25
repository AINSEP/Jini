import { describe, expect, it } from 'vitest';
import { createXaiMediaContribution } from '../index.js';
import { fakeWire, renderContext, runAdapter } from './fake-wire.js';

const contribution = createXaiMediaContribution({ mediaWire: fakeWire });
const image = contribution.adapters.image!;
const speech = contribution.adapters['audio:speech']!;
const b64 = (text: string) => JSON.stringify({ data: [{ b64_json: Buffer.from(text).toString('base64') }] });
const ttsCtx = (overrides = {}) => renderContext({ wireModel: 'grok-tts', prompt: 'hello there', ...overrides });

describe('the xAI media contribution catalogue', () => {
  it('names one provider with image, video and tts models and image + speech routes only', () => {
    expect(contribution.provider).toMatchObject({ id: 'grok', label: 'xAI Grok Imagine', integrated: true });
    expect(contribution.models.map(model => [model.id, model.surface, model.audioKind])).toEqual([
      ['grok-imagine-image', 'image', undefined], ['grok-imagine-video', 'video', undefined], ['grok-tts', 'audio', 'speech'],
    ]);
    expect(contribution.models.every(model => model.provider === 'grok')).toBe(true);
    // A catalogue video row is not a standalone video adapter: video was never dispatched by this vendor.
    expect(Object.keys(contribution.adapters).sort()).toEqual(['audio:speech', 'image']);
  });
  it('carries its endpoint default on the provider row and no environment-key fallback of its own', () => {
    expect(contribution.provider.defaultBaseUrl).toBe('https://api.x.ai/v1');
    expect(JSON.stringify(contribution)).not.toContain('XAI_API_KEY');
  });
});

describe('ImageRouter routed xAI video is not claimed by the plugin', () => {
  it('offers only its own three model ids, never the routed id ImageRouter catalogues', () => {
    const ids = contribution.models.map(model => model.id);
    expect(ids).not.toContain('xAI/grok-imagine-video');
    expect(ids.every(id => !id.includes('/'))).toBe(true);
  });
});

describe('xAI image adapter', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(runAdapter({ adapter: image, ctx: renderContext(), credentials: {}, respond: () => new Response('') })).rejects.toThrow(/no xAI credential/);
  });
  it('posts to the default base URL and decodes a b64_json response', async () => {
    const result = await runAdapter({ adapter: image, ctx: renderContext(), credentials: { apiKey: 'xai-test' }, respond: ({ url, init }) => {
      expect(url).toBe('https://api.x.ai/v1/images/generations');
      expect(JSON.parse(init.body as string)).toMatchObject({ model: 'grok-imagine-image', aspect_ratio: '16:9', n: 1, response_format: 'b64_json' });
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer xai-test');
      return new Response(b64('img-bytes'));
    } });
    expect(result.bytes.toString('utf8')).toBe('img-bytes');
    expect(result.providerNote).toBe('grok/grok-imagine-image · 16:9 · 9 bytes');
    expect(result.suggestedExt).toBe('.png');
  });
  it('honors a caller-supplied baseUrl with its trailing slash stripped, and the aspect fallback', async () => {
    let seen = '';
    await runAdapter({ adapter: image, ctx: renderContext({ aspect: '21:9', prompt: '' }), credentials: { apiKey: 'k', baseUrl: 'https://custom.x.example.com/' }, respond: ({ url, init }) => {
      seen = url;
      expect(JSON.parse(init.body as string)).toMatchObject({ aspect_ratio: '16:9', prompt: 'A high-quality reference image.' });
      return new Response(b64('x'));
    } });
    expect(seen).toBe('https://custom.x.example.com/images/generations');
  });
  it('lets the injected wire fetch bytes when the response returns a url', async () => {
    const result = await runAdapter({ adapter: image, ctx: renderContext(), credentials: { apiKey: 'k' }, respond: () => new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/grok.jpg' }] })) });
    expect(result.bytes.toString('utf8')).toBe('fetched:https://cdn.example.com/grok.jpg');
  });
  it('surfaces a tagged error on a non-OK response', async () => {
    await expect(runAdapter({ adapter: image, ctx: renderContext(), credentials: { apiKey: 'k' }, respond: () => new Response('bad request', { status: 400 }) })).rejects.toThrow(/grok image 400/);
  });
});

describe('xAI speech adapter', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(runAdapter({ adapter: speech, ctx: ttsCtx(), credentials: {}, respond: () => new Response('') })).rejects.toThrow(/no xAI credential/);
  });
  it('posts to /tts with default voice and language and returns the raw audio bytes', async () => {
    const result = await runAdapter({ adapter: speech, ctx: ttsCtx(), credentials: { apiKey: 'xai-test' }, respond: ({ url, init }) => {
      expect(url).toBe('https://api.x.ai/v1/tts');
      expect(JSON.parse(init.body as string)).toEqual({ text: 'hello there', voice_id: 'eve', language: 'en' });
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer xai-test');
      return new Response(Buffer.from('audio-bytes'));
    } });
    expect(result.bytes.toString('utf8')).toBe('audio-bytes');
    expect(result.providerNote).toBe('xai/grok-tts · voice=eve · en · 11 bytes');
    expect(result.suggestedExt).toBe('.mp3');
  });
  it('defaults a blank prompt, and honors voice, language and a baseUrl without its trailing slash', async () => {
    await runAdapter({ adapter: speech, ctx: ttsCtx({ prompt: '   ', voice: 'vex', language: 'fr' }), credentials: { apiKey: 'k', baseUrl: 'https://custom.x.example.com/' }, respond: ({ url, init }) => {
      expect(url).toBe('https://custom.x.example.com/tts');
      expect(JSON.parse(init.body as string)).toEqual({ text: 'This is a test.', voice_id: 'vex', language: 'fr' });
      return new Response(Buffer.from('x'));
    } });
  });
  it('throws a tagged error on a non-OK response and on zero bytes', async () => {
    await expect(runAdapter({ adapter: speech, ctx: ttsCtx(), credentials: { apiKey: 'k' }, respond: () => new Response('rate limited', { status: 429 }) })).rejects.toThrow(/^xai tts 429: rate limited$/);
    await expect(runAdapter({ adapter: speech, ctx: ttsCtx(), credentials: { apiKey: 'k' }, respond: () => new Response(Buffer.alloc(0)) })).rejects.toThrow(/zero bytes/);
  });
});
