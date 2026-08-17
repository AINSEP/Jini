import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderElevenLabsSfx, renderElevenLabsTTS } from '../elevenlabs.js';
import type { RenderContext } from '../../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    surface: 'audio',
    model: 'elevenlabs-v3',
    wireModel: 'elevenlabs-v3',
    prompt: 'a gentle whisper',
    aspect: undefined,
    length: undefined,
    duration: undefined,
    voice: '',
    audioKind: 'speech',
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

describe('renderElevenLabsTTS', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(renderElevenLabsTTS(baseCtx(), {})).rejects.toThrow(/no ElevenLabs credential/);
  });

  it('posts to the default base URL with the default voice and mapped model id', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=mp3_44100_128');
      const body = JSON.parse(init.body as string);
      expect(body.text).toBe('a gentle whisper');
      expect(body.model_id).toBe('eleven_v3');
      expect(body.voice_settings).toEqual({ stability: 1, similarity_boost: 1, style: 0, speed: 1, use_speaker_boost: true });
      expect((init.headers as Record<string, string>)['xi-api-key']).toBe('el-test');
      return new Response(Buffer.from('audio-bytes'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderElevenLabsTTS(baseCtx(), { apiKey: 'el-test' });
    expect(result.bytes.toString('utf8')).toBe('audio-bytes');
    expect(result.providerNote).toBe('elevenlabs/eleven_v3 · 21m00Tcm4TlvDq8ikWAM · 11 bytes');
    expect(result.suggestedExt).toBe('.mp3');
  });

  it('passes an unmapped model id through unchanged', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.model_id).toBe('some-custom-model');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderElevenLabsTTS(baseCtx({ model: 'some-custom-model' }), { apiKey: 'el-test' });
  });

  it('honors a caller-supplied voice id and a baseUrl with its trailing slash stripped', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://custom.elevenlabs.example.com/v1/text-to-speech/voice-123?output_format=mp3_44100_128');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderElevenLabsTTS(baseCtx({ voice: 'voice-123' }), { apiKey: 'el-test', baseUrl: 'https://custom.elevenlabs.example.com/' });
  });

  it('throws when the prompt is empty or whitespace-only', async () => {
    await expect(renderElevenLabsTTS(baseCtx({ prompt: '   ' }), { apiKey: 'el-test' })).rejects.toThrow(/ElevenLabs TTS prompt must not be empty/);
  });

  it('throws a truncated, tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    await expect(renderElevenLabsTTS(baseCtx(), { apiKey: 'el-test' })).rejects.toThrow(/^elevenlabs tts 429: rate limited$/);
  });

  it('throws when the response has zero bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.alloc(0), { status: 200 })));
    await expect(renderElevenLabsTTS(baseCtx(), { apiKey: 'el-test' })).rejects.toThrow(/zero bytes/);
  });
});

describe('renderElevenLabsSfx', () => {
  function sfxCtx(overrides: Partial<RenderContext> = {}): RenderContext {
    return baseCtx({ model: 'elevenlabs-sfx', wireModel: 'elevenlabs-sfx', audioKind: 'sfx', prompt: 'a door creaking open', ...overrides });
  }

  it('throws a clear error when no API key is configured', async () => {
    await expect(renderElevenLabsSfx(sfxCtx(), {})).rejects.toThrow(/no ElevenLabs credential/);
  });

  it('posts to /v1/sound-generation with default duration/prompt_influence and the mapped model id', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128');
      const body = JSON.parse(init.body as string);
      expect(body.text).toBe('a door creaking open');
      expect(body.duration_seconds).toBe(5);
      expect(body.prompt_influence).toBe(0.3);
      expect(body.loop).toBeUndefined();
      expect(body.model_id).toBe('eleven_text_to_sound_v2');
      return new Response(Buffer.from('sfx-bytes'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderElevenLabsSfx(sfxCtx(), { apiKey: 'el-test' });
    expect(result.bytes.toString('utf8')).toBe('sfx-bytes');
    expect(result.providerNote).toBe('elevenlabs/eleven_text_to_sound_v2 · 5s · 9 bytes');
  });

  it('passes an unmapped model id through unchanged', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.model_id).toBe('some-custom-sfx-model');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderElevenLabsSfx(sfxCtx({ model: 'some-custom-sfx-model' }), { apiKey: 'el-test' });
  });

  it('passes an in-range duration and promptInfluence through unchanged', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.duration_seconds).toBe(12);
      expect(body.prompt_influence).toBe(0.7);
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderElevenLabsSfx(sfxCtx({ duration: 12, promptInfluence: 0.7 }), { apiKey: 'el-test' });
  });

  it('clamps an out-of-range duration at both edges', async () => {
    const seen: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(JSON.parse(init.body as string).duration_seconds);
        return new Response(Buffer.from('x'), { status: 200 });
      }),
    );
    await renderElevenLabsSfx(sfxCtx({ duration: 0.1 }), { apiKey: 'el-test' });
    await renderElevenLabsSfx(sfxCtx({ duration: 999 }), { apiKey: 'el-test' });
    expect(seen).toEqual([0.5, 30]);
  });

  it('treats a non-finite duration as the default (5s)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        expect(JSON.parse(init.body as string).duration_seconds).toBe(5);
        return new Response(Buffer.from('x'), { status: 200 });
      }),
    );
    await renderElevenLabsSfx(sfxCtx({ duration: Number.NaN }), { apiKey: 'el-test' });
  });

  it('clamps an out-of-range promptInfluence at both edges', async () => {
    const seen: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(JSON.parse(init.body as string).prompt_influence);
        return new Response(Buffer.from('x'), { status: 200 });
      }),
    );
    await renderElevenLabsSfx(sfxCtx({ promptInfluence: -1 }), { apiKey: 'el-test' });
    await renderElevenLabsSfx(sfxCtx({ promptInfluence: 5 }), { apiKey: 'el-test' });
    expect(seen).toEqual([0, 1]);
  });

  it('sets loop:true in the body and appends the loop marker to providerNote when ctx.loop is true', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.loop).toBe(true);
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await renderElevenLabsSfx(sfxCtx({ loop: true }), { apiKey: 'el-test' });
    expect(result.providerNote).toContain('· loop');
  });

  it('throws when the prompt is empty or whitespace-only', async () => {
    await expect(renderElevenLabsSfx(sfxCtx({ prompt: '  ' }), { apiKey: 'el-test' })).rejects.toThrow(/ElevenLabs SFX prompt must not be empty/);
  });

  it('throws when the prompt exceeds 450 characters', async () => {
    await expect(renderElevenLabsSfx(sfxCtx({ prompt: 'x'.repeat(451) }), { apiKey: 'el-test' })).rejects.toThrow(/exceeds 450 characters \(451\)/);
  });

  it('throws a truncated, tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })));
    await expect(renderElevenLabsSfx(sfxCtx(), { apiKey: 'el-test' })).rejects.toThrow(/^elevenlabs sfx 400: bad request$/);
  });

  it('throws when the response has zero bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.alloc(0), { status: 200 })));
    await expect(renderElevenLabsSfx(sfxCtx(), { apiKey: 'el-test' })).rejects.toThrow(/zero bytes/);
  });
});
