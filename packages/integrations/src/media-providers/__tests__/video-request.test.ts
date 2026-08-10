import { describe, expect, it } from 'vitest';
import {
  buildVideoRequest,
  deriveVideoFamily,
  normalizeVideoResponse,
  resolveWireModel,
  snapDuration,
  snapResolutionToken,
  snapSizeToSupported,
  snapVeoSize,
} from '../video-request.js';
import type { ModelCapability } from '../types.js';

const SEEDANCE: ModelCapability = {
  id: 'seedance',
  apiModel: 'doubao-seedance-2-0-260128',
  apiModelI2V: 'doubao-seedance-2-0-260128-i2v',
  mediaType: 'video',
  caps: ['t2v', 'i2v'],
  supportedDurations: [3, 5, 8],
};

const WAN: ModelCapability = {
  id: 'wan',
  apiModel: 'wan2.5-t2v-preview',
  mediaType: 'video',
  caps: ['t2v'],
  supportedDurations: [5, 10],
};

const VEO: ModelCapability = {
  id: 'veo',
  apiModel: 'veo-3.1-generate-preview',
  mediaType: 'video',
  caps: ['t2v'],
  supportedDurations: [4, 6, 8],
};

const GENERIC: ModelCapability = {
  id: 'generic',
  apiModel: 'sora-2',
  mediaType: 'video',
  caps: ['t2v'],
  supportedSizes: ['720x1280', '1280x720'],
};

describe('resolveWireModel', () => {
  it('uses apiModelI2V when a reference is present and declared', () => {
    expect(resolveWireModel(SEEDANCE, true)).toBe('doubao-seedance-2-0-260128-i2v');
  });

  it('falls back to apiModel when no reference', () => {
    expect(resolveWireModel(SEEDANCE, false)).toBe('doubao-seedance-2-0-260128');
  });

  it('falls back to apiModel when reference is present but no apiModelI2V declared', () => {
    expect(resolveWireModel(WAN, true)).toBe('wan2.5-t2v-preview');
  });
});

describe('deriveVideoFamily', () => {
  it('honors an explicit cap.family override', () => {
    expect(deriveVideoFamily('anything', { ...GENERIC, family: 'veo' })).toBe('veo');
  });

  it('derives seedance from a doubao-seedance- prefix', () => {
    expect(deriveVideoFamily('doubao-seedance-2-0-260128')).toBe('seedance');
  });

  it('derives wan from a wan prefix', () => {
    expect(deriveVideoFamily('wan2.5-t2v-preview')).toBe('wan');
  });

  it('derives wan from a happyhorse prefix', () => {
    expect(deriveVideoFamily('happyhorse-1.0-i2v')).toBe('wan');
  });

  it('derives veo from a veo prefix', () => {
    expect(deriveVideoFamily('veo-3.1-generate-preview')).toBe('veo');
  });

  it('derives generic as the fallback', () => {
    expect(deriveVideoFamily('sora-2')).toBe('generic');
  });
});

describe('snapDuration', () => {
  it('picks the closest allowed duration', () => {
    expect(snapDuration(SEEDANCE, 4)).toBe(3);
    expect(snapDuration(SEEDANCE, 6)).toBe(5);
    expect(snapDuration(SEEDANCE, 9)).toBe(8);
  });

  it('prefers the shorter value on an exact tie', () => {
    const cap: ModelCapability = { ...SEEDANCE, supportedDurations: [4, 6] };
    expect(snapDuration(cap, 5)).toBe(4);
  });

  it('defaults the requested value to 5 when non-finite', () => {
    expect(snapDuration(WAN, Number.NaN)).toBe(5);
    expect(snapDuration(WAN, undefined)).toBe(5);
  });

  it('clamps to [3, 12] when the model declares no supportedDurations', () => {
    const { supportedDurations: _drop, ...rest } = GENERIC;
    const cap: ModelCapability = { ...rest };
    expect(snapDuration(cap, 1)).toBe(3);
    expect(snapDuration(cap, 30)).toBe(12);
    expect(snapDuration(cap, 7)).toBe(7);
  });

  it('clamps to [3, 12] when supportedDurations is an empty array', () => {
    const cap: ModelCapability = { ...GENERIC, supportedDurations: [] };
    expect(snapDuration(cap, 7)).toBe(7);
  });
});

describe('snapResolutionToken', () => {
  it('passes through an already-valid token', () => {
    expect(snapResolutionToken('720p', undefined)).toBe('720p');
    expect(snapResolutionToken('1080P', undefined)).toBe('1080p');
  });

  it('derives a token from a WxH size by short side', () => {
    expect(snapResolutionToken(undefined, '640x480')).toBe('480p');
    expect(snapResolutionToken(undefined, '1280x720')).toBe('720p');
    expect(snapResolutionToken(undefined, '1920x1080')).toBe('1080p');
  });

  it('accepts an x or × separator', () => {
    expect(snapResolutionToken(undefined, '1280×720')).toBe('720p');
  });

  it('falls back to 720p when nothing usable is supplied', () => {
    expect(snapResolutionToken(undefined, undefined)).toBe('720p');
    expect(snapResolutionToken('garbage', 'also-garbage')).toBe('720p');
  });

  it('uses the resolution field as a size source when size is absent', () => {
    expect(snapResolutionToken('640x480', undefined)).toBe('480p');
  });
});

describe('snapVeoSize', () => {
  it('passes through a known-valid size', () => {
    expect(snapVeoSize('1280x720')).toBe('1280x720');
    expect(snapVeoSize('1920X1080')).toBe('1920x1080');
  });

  it('snaps an unknown portrait size to 720x1280', () => {
    expect(snapVeoSize('900x1600')).toBe('720x1280');
  });

  it('snaps an unknown landscape size to 1280x720', () => {
    expect(snapVeoSize('1600x900')).toBe('1280x720');
  });

  it('falls back to 1280x720 for an unparseable size', () => {
    expect(snapVeoSize(undefined)).toBe('1280x720');
    expect(snapVeoSize('nonsense')).toBe('1280x720');
  });
});

describe('snapSizeToSupported', () => {
  it('returns size unchanged when the model declares no supported sizes', () => {
    expect(snapSizeToSupported('1024x1024', undefined)).toBe('1024x1024');
    expect(snapSizeToSupported('1024x1024', [])).toBe('1024x1024');
  });

  it('returns an exact (case/separator-insensitive) match', () => {
    expect(snapSizeToSupported('1280X720', ['720x1280', '1280x720'])).toBe('1280x720');
  });

  it('matches by orientation when there is no exact match', () => {
    expect(snapSizeToSupported('1024x1024', ['720x1280', '1280x720'])).toBe('1280x720');
    expect(snapSizeToSupported('900x1600', ['720x1280', '1280x720'])).toBe('720x1280');
  });

  it('an unparseable/missing size matches the landscape (non-portrait) supported entry', () => {
    expect(snapSizeToSupported(undefined, ['720x1280', '1280x720'])).toBe('1280x720');
  });

  it('falls back to the first supported size when even the orientation match fails', () => {
    expect(snapSizeToSupported(undefined, ['720x1280'])).toBe('720x1280');
  });

  it('skips a malformed (unparseable) supported entry while orientation-matching the rest', () => {
    expect(snapSizeToSupported('1024x1024', ['not-a-size', '1280x720'])).toBe('1280x720');
  });
});

describe('buildVideoRequest — seedance family', () => {
  it('builds a text-only seedance request', () => {
    const req = buildVideoRequest(SEEDANCE, { prompt: 'a cat' });
    expect(req.family).toBe('seedance');
    expect(req.wireModel).toBe('doubao-seedance-2-0-260128');
    expect(req.hasReference).toBe(false);
    expect(req.pathSuffix).toBe('/videos');
    expect(req.contentType).toBe('application/json');
    expect(req.body.content).toEqual([{ type: 'text', text: 'a cat' }]);
  });

  it('builds an i2v seedance request with a reference and extra references', () => {
    const req = buildVideoRequest(SEEDANCE, {
      prompt: 'a cat',
      imageRef: { dataUrl: 'data:image/png;base64,AAA' },
      extraImageRefs: [{ dataUrl: 'data:image/png;base64,BBB' }],
      aspectRatio: '16:9',
      generateAudio: true,
      seed: 42,
    });
    expect(req.wireModel).toBe('doubao-seedance-2-0-260128-i2v');
    expect(req.hasReference).toBe(true);
    expect(req.body.content).toEqual([
      { type: 'text', text: 'a cat' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,BBB' }, role: 'reference_image' },
    ]);
    expect(req.body.ratio).toBe('16:9');
    expect(req.body.generate_audio).toBe(true);
    expect(req.body.seed).toBe(42);
  });

  it('skips a malformed extraImageRefs entry', () => {
    const req = buildVideoRequest(SEEDANCE, {
      prompt: 'a cat',
      extraImageRefs: [{ dataUrl: '' }],
    });
    expect(req.body.content).toEqual([{ type: 'text', text: 'a cat' }]);
  });
});

describe('buildVideoRequest — wan family', () => {
  it('builds a text-only wan request', () => {
    const req = buildVideoRequest(WAN, { prompt: 'a dog', resolution: '720p' });
    expect(req.family).toBe('wan');
    const input = req.body.input as Record<string, unknown>;
    expect(input.prompt).toBe('a dog');
    expect(input.media).toBeUndefined();
    const parameters = req.body.parameters as Record<string, unknown>;
    expect(parameters.resolution).toBe('720P');
    expect(parameters.watermark).toBe(false);
    expect(parameters.prompt_extend).toBe(true);
  });

  it('builds an i2v wan request with aspect ratio and seed', () => {
    const req = buildVideoRequest(WAN, {
      prompt: 'a dog',
      imageRef: { dataUrl: 'data:image/png;base64,AAA' },
      aspectRatio: '9:16',
      seed: 7,
    });
    const input = req.body.input as Record<string, unknown>;
    expect(input.media).toEqual([{ type: 'first_frame', url: 'data:image/png;base64,AAA' }]);
    const parameters = req.body.parameters as Record<string, unknown>;
    expect(parameters.aspect_ratio).toBe('9:16');
    expect(parameters.seed).toBe(7);
  });
});

describe('buildVideoRequest — veo family', () => {
  it('builds a veo request with a snapped size', () => {
    const req = buildVideoRequest(VEO, { prompt: 'a bird', size: '1024x1024', generateAudio: false, seed: 1 });
    expect(req.family).toBe('veo');
    expect(req.body.size).toBe('1280x720');
    expect(req.body.seconds).toBe(4);
    expect(req.body.generate_audio).toBe(false);
    expect(req.body.seed).toBe(1);
  });

  it('builds a minimal veo request with no optional fields', () => {
    const req = buildVideoRequest(VEO, { prompt: 'a bird' });
    expect(req.body.generate_audio).toBeUndefined();
    expect(req.body.seed).toBeUndefined();
  });
});

describe('buildVideoRequest — generic family', () => {
  it('builds a generic request with a snapped size, resolution, and reference', () => {
    const req = buildVideoRequest(GENERIC, {
      prompt: 'a fish',
      size: '1024x1024',
      resolution: 'hd',
      imageRef: { dataUrl: 'data:image/png;base64,AAA' },
      generateAudio: true,
      seed: 3,
    });
    expect(req.family).toBe('generic');
    expect(req.body.seconds).toBe('5');
    expect(req.body.size).toBe('1280x720');
    expect(req.body.resolution).toBe('hd');
    expect(req.body.input_reference).toBe('data:image/png;base64,AAA');
    expect(req.body.generate_audio).toBe(true);
    expect(req.body.seed).toBe(3);
  });

  it('omits size when snapSizeToSupported returns undefined-ish (no supportedSizes and no size given)', () => {
    const { supportedSizes: _drop, ...rest } = GENERIC;
    const cap: ModelCapability = { ...rest };
    const req = buildVideoRequest(cap, { prompt: 'a fish' });
    expect(req.body.size).toBeUndefined();
  });
});

describe('buildVideoRequest — extraBodyDefaults + passthrough', () => {
  it('applies extraBodyDefaults and filters passthrough by the whitelist', () => {
    const cap: ModelCapability = {
      ...GENERIC,
      extraBodyDefaults: [{ name: 'watermark', type: 'boolean', default: false }],
      allowedPassthroughParameters: ['style'],
    };
    const req = buildVideoRequest(cap, {
      prompt: 'a fish',
      passthrough: { style: 'anime', notAllowed: 'nope' },
    });
    expect(req.body.watermark).toBe(false);
    expect(req.body.style).toBe('anime');
    expect(req.body.notAllowed).toBeUndefined();
  });

  it('skips a passthrough key whose value is undefined', () => {
    const cap: ModelCapability = { ...GENERIC, allowedPassthroughParameters: ['style'] };
    const req = buildVideoRequest(cap, { prompt: 'a fish', passthrough: { style: undefined } });
    expect('style' in req.body).toBe(false);
  });

  it('does nothing when the model declares no extraBodyDefaults/allowedPassthroughParameters', () => {
    const req = buildVideoRequest(GENERIC, { prompt: 'a fish', passthrough: { style: 'anime' } });
    expect(req.body.style).toBeUndefined();
  });
});

describe('normalizeVideoResponse', () => {
  it('reads id/status/url/error from the top level', () => {
    expect(normalizeVideoResponse({ id: 't1', status: 'done', video_url: 'https://x/y.mp4' })).toEqual({
      id: 't1',
      status: 'done',
      url: 'https://x/y.mp4',
    });
  });

  it('falls back to task_id and nested data.id/data.status', () => {
    expect(normalizeVideoResponse({ task_id: 't2', data: { status: 'running' } })).toEqual({
      id: 't2',
      status: 'running',
    });
    expect(normalizeVideoResponse({ data: { id: 't3', task_id: 't4' } })).toEqual({ id: 't3' });
  });

  it('reads url from url/output_url/data.video_url/data.url/data[0].url/unsigned_urls[0]', () => {
    expect(normalizeVideoResponse({ url: 'https://x/1.mp4' }).url).toBe('https://x/1.mp4');
    expect(normalizeVideoResponse({ output_url: 'https://x/2.mp4' }).url).toBe('https://x/2.mp4');
    expect(normalizeVideoResponse({ data: { video_url: 'https://x/3.mp4' } }).url).toBe('https://x/3.mp4');
    expect(normalizeVideoResponse({ data: { url: 'https://x/4.mp4' } }).url).toBe('https://x/4.mp4');
    expect(normalizeVideoResponse({ data: [{ url: 'https://x/5.mp4' }] }).url).toBe('https://x/5.mp4');
    expect(normalizeVideoResponse({ unsigned_urls: ['https://x/6.mp4'] }).url).toBe('https://x/6.mp4');
  });

  it('reads error from error.message, a string error, failure_reason, or message', () => {
    expect(normalizeVideoResponse({ error: { message: 'boom' } }).error).toBe('boom');
    expect(normalizeVideoResponse({ error: 'boom-string' }).error).toBe('boom-string');
    expect(normalizeVideoResponse({ failure_reason: 'boom-reason' }).error).toBe('boom-reason');
    expect(normalizeVideoResponse({ message: 'boom-message' }).error).toBe('boom-message');
  });

  it('returns an empty object for an empty/nullish input', () => {
    expect(normalizeVideoResponse({})).toEqual({});
    expect(normalizeVideoResponse(null)).toEqual({});
    expect(normalizeVideoResponse(undefined)).toEqual({});
  });

  it('returns an empty object when data is an empty array (no [0] to read)', () => {
    expect(normalizeVideoResponse({ data: [] })).toEqual({});
  });
});
