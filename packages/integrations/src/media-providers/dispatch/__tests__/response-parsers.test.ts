import { describe, expect, it } from 'vitest';
import { createHexEnvelopeAudioParser, createRawBytesParser } from '../response-parsers.js';
import type { VendorRequest } from '../vendor-adapter.js';
import type { RenderContext } from '../types.js';

function baseCtx(): RenderContext {
  return {
    surface: 'audio',
    model: 'm',
    wireModel: 'm',
    prompt: '',
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
  };
}

function req<Meta>(meta: Meta): VendorRequest<Meta> {
  return { url: 'https://example.com', init: {}, meta };
}

describe('createRawBytesParser', () => {
  it('returns bytes/providerNote/suggestedExt on a successful response (static options)', async () => {
    const parser = createRawBytesParser<undefined>({
      errorTag: 'vendor x',
      zeroBytesMessage: 'vendor x returned zero bytes',
      note: (bytes) => `vendor-x · ${bytes.length} bytes`,
      suggestedExt: '.mp3',
    });
    const resp = new Response(Buffer.from('audio-data'), { status: 200 });
    const result = await parser(resp, baseCtx(), req(undefined));
    expect(result.bytes.toString('utf8')).toBe('audio-data');
    expect(result.providerNote).toBe('vendor-x · 10 bytes');
    expect(result.suggestedExt).toBe('.mp3');
  });

  it('throws a truncated, tagged error on a non-OK response (static errorTag)', async () => {
    const parser = createRawBytesParser<undefined>({
      errorTag: 'vendor x',
      zeroBytesMessage: 'zero',
      note: () => '',
      suggestedExt: '.mp3',
    });
    const resp = new Response('rate limited', { status: 429 });
    await expect(parser(resp, baseCtx(), req(undefined))).rejects.toThrow(/^vendor x 429: rate limited$/);
  });

  it('truncates a long error body to 240 chars plus an ellipsis', async () => {
    const parser = createRawBytesParser<undefined>({
      errorTag: 'vendor x',
      zeroBytesMessage: 'zero',
      note: () => '',
      suggestedExt: '.mp3',
    });
    const longBody = 'e'.repeat(500);
    const resp = new Response(longBody, { status: 500 });
    await expect(parser(resp, baseCtx(), req(undefined))).rejects.toThrow(new RegExp(`vendor x 500: e{239}…$`));
  });

  it('throws the configured message when the body decodes to zero bytes', async () => {
    const parser = createRawBytesParser<undefined>({
      errorTag: 'vendor x',
      zeroBytesMessage: 'vendor x returned zero bytes',
      note: () => '',
      suggestedExt: '.mp3',
    });
    const resp = new Response(Buffer.alloc(0), { status: 200 });
    await expect(parser(resp, baseCtx(), req(undefined))).rejects.toThrow(/vendor x returned zero bytes/);
  });

  it('resolves a function errorTag/zeroBytesMessage/suggestedExt from request.meta', async () => {
    interface Meta {
      readonly tag: string;
      readonly ext: string;
    }
    const parser = createRawBytesParser<Meta>({
      errorTag: (meta) => `${meta.tag} dynamic`,
      zeroBytesMessage: (meta) => `${meta.tag} says zero bytes`,
      note: (bytes, meta) => `${meta.tag}/${bytes.length}`,
      suggestedExt: (_bytes, meta) => meta.ext,
    });

    const errResp = new Response('bad', { status: 400 });
    await expect(parser(errResp, baseCtx(), req<Meta>({ tag: 'acme', ext: '.wav' }))).rejects.toThrow(/^acme dynamic 400: bad$/);

    const zeroResp = new Response(Buffer.alloc(0), { status: 200 });
    await expect(parser(zeroResp, baseCtx(), req<Meta>({ tag: 'acme', ext: '.wav' }))).rejects.toThrow(/acme says zero bytes/);

    const okResp = new Response(Buffer.from('hi'), { status: 200 });
    const result = await parser(okResp, baseCtx(), req<Meta>({ tag: 'acme', ext: '.wav' }));
    expect(result.providerNote).toBe('acme/2');
    expect(result.suggestedExt).toBe('.wav');
  });
});

describe('createHexEnvelopeAudioParser', () => {
  const parser = createHexEnvelopeAudioParser<{ wireModel: string; voiceId: string }>({
    errorTag: 'acme tts',
    providerId: 'acme',
  });
  const meta = { wireModel: 'acme-v2', voiceId: 'voice-1' };

  function okResponse(data: unknown): Response {
    return new Response(JSON.stringify(data), { status: 200 });
  }

  it('decodes hex audio, formats providerNote with seconds computed from audio_length (centiseconds)', async () => {
    const result = await parser(
      okResponse({ data: { audio: Buffer.from('audio-bytes').toString('hex') }, extra_info: { audio_length: 500 } }),
      baseCtx(),
      req(meta),
    );
    expect(result.bytes.toString('utf8')).toBe('audio-bytes');
    expect(result.providerNote).toBe('acme/acme-v2 · voice-1 · 0.5s · 11 bytes');
    expect(result.suggestedExt).toBe('.mp3');
  });

  it('reports "?" seconds when extra_info.audio_length is absent', async () => {
    const result = await parser(okResponse({ data: { audio: Buffer.from('x').toString('hex') } }), baseCtx(), req(meta));
    expect(result.providerNote).toContain('· ?s ·');
  });

  it('throws a truncated, tagged error on a non-OK response', async () => {
    await expect(parser(new Response('rate limited', { status: 429 }), baseCtx(), req(meta))).rejects.toThrow(/^acme tts 429: rate limited$/);
  });

  it('throws a clear error on a non-JSON response body', async () => {
    await expect(parser(new Response('not json', { status: 200 }), baseCtx(), req(meta))).rejects.toThrow(/acme tts non-JSON/);
  });

  it('throws an api-error when base_resp.status_code is non-zero, using status_msg when present', async () => {
    await expect(
      parser(okResponse({ base_resp: { status_code: 1004, status_msg: 'invalid api key' } }), baseCtx(), req(meta)),
    ).rejects.toThrow(/acme tts api error 1004: invalid api key/);
  });

  it('falls back to "unknown" when base_resp.status_code is non-zero but status_msg is absent', async () => {
    await expect(parser(okResponse({ base_resp: { status_code: 1002 } }), baseCtx(), req(meta))).rejects.toThrow(
      /acme tts api error 1002: unknown/,
    );
  });

  it('does not throw the api-error path when base_resp.status_code is 0', async () => {
    const result = await parser(
      okResponse({ base_resp: { status_code: 0, status_msg: 'success' }, data: { audio: Buffer.from('x').toString('hex') } }),
      baseCtx(),
      req(meta),
    );
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it('throws when data.audio is missing', async () => {
    await expect(parser(okResponse({ data: {} }), baseCtx(), req(meta))).rejects.toThrow(/response missing data\.audio/);
  });

  it('throws when the hex payload decodes to zero bytes', async () => {
    await expect(parser(okResponse({ data: { audio: 'zz' } }), baseCtx(), req(meta))).rejects.toThrow(/decoded zero bytes/);
  });
});
