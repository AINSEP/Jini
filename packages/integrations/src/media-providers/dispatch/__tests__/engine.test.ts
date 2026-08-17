import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMediaDispatchEngine, lookupRoute } from '../engine.js';
import type { Renderer } from '../engine.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lookupRoute', () => {
  // The production ROUTES table in engine.ts is empty — every vendor it
  // used to hold has migrated onto mediaVendorRegistry (see engine.ts's
  // module doc) — so these tests exercise lookupRoute directly against a
  // locally-constructed ROUTES-shaped table instead, proving every branch
  // of its `routes[providerId]?.[routeKey]` lookup without needing a real,
  // currently-nonexistent ROUTES-only vendor.
  const renderer: Renderer = async () => ({ bytes: Buffer.alloc(0), providerNote: 'x' });

  it('finds a renderer registered for a known providerId + routeKey', () => {
    expect(lookupRoute({ acme: { image: renderer } }, 'acme', 'image')).toBe(renderer);
  });

  it('returns undefined for an unknown providerId', () => {
    expect(lookupRoute({}, 'acme', 'image')).toBeUndefined();
  });

  it('returns undefined for a known providerId but unregistered routeKey', () => {
    expect(lookupRoute({ acme: { image: renderer } }, 'acme', 'audio:speech')).toBeUndefined();
  });
});

describe('createMediaDispatchEngine — validation', () => {
  it('rejects an unsupported surface', async () => {
    const engine = createMediaDispatchEngine();
    await expect(engine.generate({ surface: 'unknown' as never, model: 'x' })).rejects.toThrow(/unsupported surface/);
  });

  it('rejects a missing model', async () => {
    const engine = createMediaDispatchEngine();
    await expect(engine.generate({ surface: 'image', model: '' })).rejects.toThrow(/model required/);
  });

  it('rejects an unknown model id', async () => {
    const engine = createMediaDispatchEngine();
    await expect(engine.generate({ surface: 'image', model: 'not-a-real-model' })).rejects.toThrow(/unknown model/);
  });

  it('rejects a model not registered for the given surface', async () => {
    const engine = createMediaDispatchEngine();
    // gpt-image-2 is an image model, not a video model.
    await expect(engine.generate({ surface: 'video', model: 'gpt-image-2' })).rejects.toThrow(/not registered for surface "video"/);
  });

  it('rejects an invalid audioKind', async () => {
    const engine = createMediaDispatchEngine();
    await expect(engine.generate({ surface: 'audio', model: 'gpt-4o-mini-tts', audioKind: 'bogus' as never })).rejects.toThrow(/unsupported audioKind/);
  });

  it('rejects a model not registered for the resolved audioKind', async () => {
    const engine = createMediaDispatchEngine();
    // gpt-4o-mini-tts is a 'speech' model, not registered under 'music'.
    await expect(engine.generate({ surface: 'audio', model: 'gpt-4o-mini-tts', audioKind: 'music' })).rejects.toThrow(/not registered for surface "audio · music"/);
  });

  it('defaults audioKind to "music" when omitted entirely', async () => {
    const engine = createMediaDispatchEngine();
    // Same assertion as the explicit-'music' case above, but proves the
    // `request.audioKind || 'music'` default itself, not just that 'music'
    // works when passed explicitly.
    await expect(engine.generate({ surface: 'audio', model: 'gpt-4o-mini-tts' })).rejects.toThrow(/not registered for surface "audio · music"/);
  });
});

describe('createMediaDispatchEngine — clamping', () => {
  it('clamps an out-of-range video length and reports a warning', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('vid').toString('base64') }] }), { status: 200 })),
    );
    const engine = createMediaDispatchEngine({ credentials: { imagerouter: { apiKey: 'k' } } });
    const result = await engine.generate({ surface: 'video', model: 'bytedance/seedance-1.5-pro', length: 9999 });
    expect(result.warnings.some((w) => w.includes('clamped'))).toBe(true);
  });

  it('does not warn when length is already an allowed value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('vid').toString('base64') }] }), { status: 200 })),
    );
    const engine = createMediaDispatchEngine({ credentials: { imagerouter: { apiKey: 'k' } } });
    const result = await engine.generate({ surface: 'video', model: 'bytedance/seedance-1.5-pro', length: 8 });
    expect(result.warnings).toEqual([]);
  });

  it('clamps an out-of-range audio duration and reports a warning', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('audio'), { status: 200 })));
    const engine = createMediaDispatchEngine({ credentials: { openai: { apiKey: 'sk-test' } } });
    const result = await engine.generate({ surface: 'audio', audioKind: 'speech', model: 'gpt-4o-mini-tts', duration: 9999 });
    expect(result.warnings.some((w) => w.includes('duration'))).toBe(true);
  });
});

describe('createMediaDispatchEngine — dispatch routing', () => {
  it('routes openai + image to renderOpenAIImage with the configured credentials', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('gpt-image-2');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const engine = createMediaDispatchEngine({ credentials: { openai: { apiKey: 'sk-test' } } });
    const result = await engine.generate({ surface: 'image', model: 'gpt-image-2', prompt: 'x' });
    expect(result.providerId).toBe('openai');
    expect(result.usedStubFallback).toBe(false);
    expect(result.bytes.toString('utf8')).toBe('img');
  });

  it('routes openai + audio:speech to renderOpenAISpeech', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('audio'), { status: 200 })));
    const engine = createMediaDispatchEngine({ credentials: { openai: { apiKey: 'sk-test' } } });
    const result = await engine.generate({ surface: 'audio', audioKind: 'speech', model: 'gpt-4o-mini-tts' });
    expect(result.providerId).toBe('openai');
    expect(result.bytes.toString('utf8')).toBe('audio');
  });

  it('routes imagerouter + image and imagerouter + video', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 })),
    );
    const engine = createMediaDispatchEngine({ credentials: { imagerouter: { apiKey: 'k' } } });
    const imageResult = await engine.generate({ surface: 'image', model: 'openai/gpt-image-2' });
    expect(imageResult.providerId).toBe('imagerouter');
    const videoResult = await engine.generate({ surface: 'video', model: 'bytedance/seedance-1.5-pro' });
    expect(videoResult.providerId).toBe('imagerouter');
  });

  it('routes custom-image + image to renderCustomOpenAIImage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 })),
    );
    const engine = createMediaDispatchEngine({ credentials: { 'custom-image': { baseUrl: 'https://x.example.com', model: 'm' } } });
    const result = await engine.generate({ surface: 'image', model: 'custom-image' });
    expect(result.providerId).toBe('custom-image');
  });

  it('threads a single imageRef through to a renderer that consumes it (custom-image -> /images/edits)', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://x.example.com/images/edits');
      const body = JSON.parse(init.body as string);
      expect(body.images).toEqual([{ image_url: 'data:image/png;base64,REF' }]);
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const engine = createMediaDispatchEngine({ credentials: { 'custom-image': { baseUrl: 'https://x.example.com', model: 'm' } } });
    const result = await engine.generate({
      surface: 'image',
      model: 'custom-image',
      imageRef: { dataUrl: 'data:image/png;base64,REF' },
    });
    expect(result.providerId).toBe('custom-image');
  });

  it('overrides an openai+image request to custom-image when custom-image credentials name the same model', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://custom.example.com/images/generations');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const engine = createMediaDispatchEngine({
      credentials: {
        openai: { apiKey: 'sk-should-not-be-used' },
        'custom-image': { baseUrl: 'https://custom.example.com', model: 'dall-e-3' },
      },
    });
    const result = await engine.generate({ surface: 'image', model: 'dall-e-3' });
    expect(result.providerId).toBe('custom-image');
  });

  it('routes grok + image to renderGrokImage', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.x.ai/v1/images/generations');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('grok-imagine-image');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const engine = createMediaDispatchEngine({ credentials: { grok: { apiKey: 'xai-key' } } });
    const result = await engine.generate({ surface: 'image', model: 'grok-imagine-image' });
    expect(result.providerId).toBe('grok');
  });

  it('routes grok + audio:speech to renderXAITTS', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.x.ai/v1/tts');
      return new Response(Buffer.from('audio'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const engine = createMediaDispatchEngine({ credentials: { grok: { apiKey: 'xai-key' } } });
    const result = await engine.generate({ surface: 'audio', audioKind: 'speech', model: 'grok-tts' });
    expect(result.providerId).toBe('grok');
    expect(result.bytes.toString('utf8')).toBe('audio');
  });

  it('routes nanobanana + image to renderNanoBananaImage', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent');
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('x').toString('base64') } }] } }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const engine = createMediaDispatchEngine({ credentials: { nanobanana: { apiKey: 'g-key' } } });
    const result = await engine.generate({ surface: 'image', model: 'gemini-3.1-flash-image-preview' });
    expect(result.providerId).toBe('nanobanana');
  });

  it('routes openrouter + image to renderOpenRouterImage', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      const dataUrl = `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
      return new Response(JSON.stringify({ choices: [{ message: { images: [{ image_url: { url: dataUrl } }] } }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const engine = createMediaDispatchEngine({ credentials: { openrouter: { apiKey: 'or-key' } } });
    const result = await engine.generate({ surface: 'image', model: 'openrouter/black-forest-labs/flux-1.1-pro' });
    expect(result.providerId).toBe('openrouter');
  });

  it('routes volcengine + image to renderVolcengineImage', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('doubao-seedream-3-0-t2i-250415');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const engine = createMediaDispatchEngine({ credentials: { volcengine: { apiKey: 'ark-key' } } });
    const result = await engine.generate({ surface: 'image', model: 'doubao-seedream-3-0-t2i-250415' });
    expect(result.providerId).toBe('volcengine');
  });

  it('routes elevenlabs + audio:speech and elevenlabs + audio:sfx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('audio'), { status: 200 })));
    const engine = createMediaDispatchEngine({ credentials: { elevenlabs: { apiKey: 'el-key' } } });
    const ttsResult = await engine.generate({ surface: 'audio', audioKind: 'speech', model: 'elevenlabs-v3', prompt: 'hi' });
    expect(ttsResult.providerId).toBe('elevenlabs');
    const sfxResult = await engine.generate({ surface: 'audio', audioKind: 'sfx', model: 'elevenlabs-sfx', prompt: 'a door creak' });
    expect(sfxResult.providerId).toBe('elevenlabs');
  });

  it('routes minimax + audio:speech to renderMinimaxTTS', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { audio: Buffer.from('audio').toString('hex') } }), { status: 200 })));
    const engine = createMediaDispatchEngine({ credentials: { minimax: { apiKey: 'mm-key' } } });
    const result = await engine.generate({ surface: 'audio', audioKind: 'speech', model: 'minimax-tts' });
    expect(result.providerId).toBe('minimax');
    expect(result.bytes.toString('utf8')).toBe('audio');
  });

  it('routes senseaudio + image and senseaudio + audio:speech', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://api.senseaudio.cn/v1/image/sync') {
        return new Response(JSON.stringify({ url: 'http://203.0.113.5/out.png' }), { status: 200 });
      }
      if (url === 'http://203.0.113.5/out.png') {
        return new Response(Buffer.from('img'), { status: 200 });
      }
      if (url === 'https://api.senseaudio.cn/v1/t2a_v2') {
        return new Response(JSON.stringify({ data: { audio: Buffer.from('audio').toString('hex') } }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const engine = createMediaDispatchEngine({ credentials: { senseaudio: { apiKey: 'sa-key' } } });
    const imageResult = await engine.generate({ surface: 'image', model: 'senseaudio-image-2.0-260319' });
    expect(imageResult.providerId).toBe('senseaudio');
    const ttsResult = await engine.generate({ surface: 'audio', audioKind: 'speech', model: 'senseaudio-tts' });
    expect(ttsResult.providerId).toBe('senseaudio');
  });

  it('routes fishaudio + audio:speech to renderFishAudioTTS', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('audio'), { status: 200 })));
    const engine = createMediaDispatchEngine({ credentials: { fishaudio: { apiKey: 'fa-key' } } });
    const result = await engine.generate({ surface: 'audio', audioKind: 'speech', model: 'fish-speech-2' });
    expect(result.providerId).toBe('fishaudio');
    expect(result.bytes.toString('utf8')).toBe('audio');
  });

  it('routes aihubmix + image and aihubmix + audio:speech', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://aihubmix.com/v1/images/generations') {
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }), { status: 200 });
      }
      if (url === 'https://aihubmix.com/v1/audio/speech') {
        return new Response(Buffer.from('audio'), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const engine = createMediaDispatchEngine({ credentials: { aihubmix: { apiKey: 'ahm-key' } } });
    const imageResult = await engine.generate({ surface: 'image', model: 'aihubmix-gpt-image-1' });
    expect(imageResult.providerId).toBe('aihubmix');
    const ttsResult = await engine.generate({ surface: 'audio', audioKind: 'speech', model: 'aihubmix-tts-1' });
    expect(ttsResult.providerId).toBe('aihubmix');
  });

  it('does not override when custom-image credentials name a different model', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.openai.com/v1/images/generations');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const engine = createMediaDispatchEngine({
      credentials: {
        openai: { apiKey: 'sk-test' },
        'custom-image': { baseUrl: 'https://custom.example.com', model: 'some-other-model' },
      },
    });
    const result = await engine.generate({ surface: 'image', model: 'dall-e-3' });
    expect(result.providerId).toBe('openai');
  });
});

describe('createMediaDispatchEngine — stub fallback', () => {
  it('throws a clear error when no renderer is wired and allowStubFallback is not set (fail closed by default)', async () => {
    const engine = createMediaDispatchEngine();
    // leonardo+image has no renderer in this pass — the real vendor call is
    // submit-then-poll shaped (see source-map.md), deferred alongside the
    // other async-polling vendors rather than ported this pass.
    await expect(engine.generate({ surface: 'image', model: 'leonardo-phoenix' })).rejects.toThrow(/no renderer configured/);
  });

  it('returns placeholder bytes when allowStubFallback is true and no renderer is wired', async () => {
    const engine = createMediaDispatchEngine({ allowStubFallback: true });
    const result = await engine.generate({ surface: 'image', model: 'leonardo-phoenix' });
    expect(result.usedStubFallback).toBe(true);
    expect(result.providerId).toBe('leonardo');
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it('never falls back to a stub for a (provider, surface) pair that IS wired, even with allowStubFallback true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('real').toString('base64') }] }), { status: 200 })),
    );
    const engine = createMediaDispatchEngine({ allowStubFallback: true, credentials: { openai: { apiKey: 'sk-test' } } });
    const result = await engine.generate({ surface: 'image', model: 'gpt-image-2' });
    expect(result.usedStubFallback).toBe(false);
    expect(result.bytes.toString('utf8')).toBe('real');
  });
});
