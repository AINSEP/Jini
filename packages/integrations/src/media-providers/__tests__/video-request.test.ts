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
        expect(resolveWireModel({ cap: SEEDANCE, hasReference: true })).toBe('doubao-seedance-2-0-260128-i2v');
    });
    it('falls back to apiModel when no reference', () => {
        expect(resolveWireModel({ cap: SEEDANCE, hasReference: false })).toBe('doubao-seedance-2-0-260128');
    });
    it('falls back to apiModel when reference is present but no apiModelI2V declared', () => {
        expect(resolveWireModel({ cap: WAN, hasReference: true })).toBe('wan2.5-t2v-preview');
    });
});

describe('deriveVideoFamily', () => {
    it('honors an explicit cap.family override', () => {
        expect(deriveVideoFamily({ wireModel: 'anything' }, { cap: { ...GENERIC, family: 'veo' } })).toBe('veo');
    });
    it('derives seedance from a doubao-seedance- prefix', () => {
        expect(deriveVideoFamily({ wireModel: 'doubao-seedance-2-0-260128' })).toBe('seedance');
    });
    it('derives wan from a wan prefix', () => {
        expect(deriveVideoFamily({ wireModel: 'wan2.5-t2v-preview' })).toBe('wan');
    });
    it('derives wan from a happyhorse prefix', () => {
        expect(deriveVideoFamily({ wireModel: 'happyhorse-1.0-i2v' })).toBe('wan');
    });
    it('derives veo from a veo prefix', () => {
        expect(deriveVideoFamily({ wireModel: 'veo-3.1-generate-preview' })).toBe('veo');
    });
    it('derives generic as the fallback', () => {
        expect(deriveVideoFamily({ wireModel: 'sora-2' })).toBe('generic');
    });
});

describe('snapDuration', () => {
    it('picks the closest allowed duration', () => {
        expect(snapDuration({ cap: SEEDANCE, requested: 4 })).toBe(3);
        expect(snapDuration({ cap: SEEDANCE, requested: 6 })).toBe(5);
        expect(snapDuration({ cap: SEEDANCE, requested: 9 })).toBe(8);
    });
    it('prefers the shorter value on an exact tie', () => {
        const cap: ModelCapability = { ...SEEDANCE, supportedDurations: [4, 6] };
        expect(snapDuration({ cap: cap, requested: 5 })).toBe(4);
    });
    it('defaults the requested value to 5 when non-finite', () => {
        expect(snapDuration({ cap: WAN, requested: Number.NaN })).toBe(5);
        expect(snapDuration({ cap: WAN, requested: undefined })).toBe(5);
    });
    it('clamps to [3, 12] when the model declares no supportedDurations', () => {
        const { supportedDurations: _drop, ...rest } = GENERIC;
        const cap: ModelCapability = { ...rest };
        expect(snapDuration({ cap: cap, requested: 1 })).toBe(3);
        expect(snapDuration({ cap: cap, requested: 30 })).toBe(12);
        expect(snapDuration({ cap: cap, requested: 7 })).toBe(7);
    });
    it('clamps to [3, 12] when supportedDurations is an empty array', () => {
        const cap: ModelCapability = { ...GENERIC, supportedDurations: [] };
        expect(snapDuration({ cap: cap, requested: 7 })).toBe(7);
    });
});

describe('snapResolutionToken', () => {
    it('passes through an already-valid token', () => {
        expect(snapResolutionToken({ resolution: '720p', size: undefined })).toBe('720p');
        expect(snapResolutionToken({ resolution: '1080P', size: undefined })).toBe('1080p');
    });
    it('derives a token from a WxH size by short side', () => {
        expect(snapResolutionToken({ resolution: undefined, size: '640x480' })).toBe('480p');
        expect(snapResolutionToken({ resolution: undefined, size: '1280x720' })).toBe('720p');
        expect(snapResolutionToken({ resolution: undefined, size: '1920x1080' })).toBe('1080p');
    });
    it('accepts an x or × separator', () => {
        expect(snapResolutionToken({ resolution: undefined, size: '1280×720' })).toBe('720p');
    });
    it('falls back to 720p when nothing usable is supplied', () => {
        expect(snapResolutionToken({ resolution: undefined, size: undefined })).toBe('720p');
        expect(snapResolutionToken({ resolution: 'garbage', size: 'also-garbage' })).toBe('720p');
    });
    it('uses the resolution field as a size source when size is absent', () => {
        expect(snapResolutionToken({ resolution: '640x480', size: undefined })).toBe('480p');
    });
});

describe('snapVeoSize', () => {
    it('passes through a known-valid size', () => {
        expect(snapVeoSize({ size: '1280x720' })).toBe('1280x720');
        expect(snapVeoSize({ size: '1920X1080' })).toBe('1920x1080');
    });
    it('snaps an unknown portrait size to 720x1280', () => {
        expect(snapVeoSize({ size: '900x1600' })).toBe('720x1280');
    });
    it('snaps an unknown landscape size to 1280x720', () => {
        expect(snapVeoSize({ size: '1600x900' })).toBe('1280x720');
    });
    it('falls back to 1280x720 for an unparseable size', () => {
        expect(snapVeoSize({ size: undefined })).toBe('1280x720');
        expect(snapVeoSize({ size: 'nonsense' })).toBe('1280x720');
    });
});

describe('snapSizeToSupported', () => {
    it('returns size unchanged when the model declares no supported sizes', () => {
        expect(snapSizeToSupported({ size: '1024x1024', supported: undefined })).toBe('1024x1024');
        expect(snapSizeToSupported({ size: '1024x1024', supported: [] })).toBe('1024x1024');
    });
    it('returns an exact (case/separator-insensitive) match', () => {
        expect(snapSizeToSupported({ size: '1280X720', supported: ['720x1280', '1280x720'] })).toBe('1280x720');
    });
    it('matches by orientation when there is no exact match', () => {
        expect(snapSizeToSupported({ size: '1024x1024', supported: ['720x1280', '1280x720'] })).toBe('1280x720');
        expect(snapSizeToSupported({ size: '900x1600', supported: ['720x1280', '1280x720'] })).toBe('720x1280');
    });
    it('an unparseable/missing size matches the landscape (non-portrait) supported entry', () => {
        expect(snapSizeToSupported({ size: undefined, supported: ['720x1280', '1280x720'] })).toBe('1280x720');
    });
    it('falls back to the first supported size when even the orientation match fails', () => {
        expect(snapSizeToSupported({ size: undefined, supported: ['720x1280'] })).toBe('720x1280');
    });
    it('skips a malformed (unparseable) supported entry while orientation-matching the rest', () => {
        expect(snapSizeToSupported({ size: '1024x1024', supported: ['not-a-size', '1280x720'] })).toBe('1280x720');
    });
});

describe('buildVideoRequest — seedance family', () => {
    it('builds a text-only seedance request', () => {
        const req = buildVideoRequest({ cap: SEEDANCE, input: { prompt: 'a cat' } });
        expect(req.family).toBe('seedance');
        expect(req.wireModel).toBe('doubao-seedance-2-0-260128');
        expect(req.hasReference).toBe(false);
        expect(req.pathSuffix).toBe('/videos');
        expect(req.contentType).toBe('application/json');
        expect(req.body.content).toEqual([{ type: 'text', text: 'a cat' }]);
    });
    it('builds an i2v seedance request with a reference and extra references', () => {
        const req = buildVideoRequest({ cap: SEEDANCE, input: {
                prompt: 'a cat',
                imageRef: { dataUrl: 'data:image/png;base64,AAA' },
                extraImageRefs: [{ dataUrl: 'data:image/png;base64,BBB' }],
                aspectRatio: '16:9',
                generateAudio: true,
                seed: 42,
            } });
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
        const req = buildVideoRequest({ cap: SEEDANCE, input: {
                prompt: 'a cat',
                extraImageRefs: [{ dataUrl: '' }],
            } });
        expect(req.body.content).toEqual([{ type: 'text', text: 'a cat' }]);
    });
});

describe('buildVideoRequest — wan family', () => {
    it('builds a text-only wan request', () => {
        const req = buildVideoRequest({ cap: WAN, input: { prompt: 'a dog', resolution: '720p' } });
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
        const req = buildVideoRequest({ cap: WAN, input: {
                prompt: 'a dog',
                imageRef: { dataUrl: 'data:image/png;base64,AAA' },
                aspectRatio: '9:16',
                seed: 7,
            } });
        const input = req.body.input as Record<string, unknown>;
        expect(input.media).toEqual([{ type: 'first_frame', url: 'data:image/png;base64,AAA' }]);
        const parameters = req.body.parameters as Record<string, unknown>;
        expect(parameters.aspect_ratio).toBe('9:16');
        expect(parameters.seed).toBe(7);
    });
});

describe('buildVideoRequest — veo family', () => {
    it('builds a veo request with a snapped size', () => {
        const req = buildVideoRequest({ cap: VEO, input: { prompt: 'a bird', size: '1024x1024', generateAudio: false, seed: 1 } });
        expect(req.family).toBe('veo');
        expect(req.body.size).toBe('1280x720');
        expect(req.body.seconds).toBe(4);
        expect(req.body.generate_audio).toBe(false);
        expect(req.body.seed).toBe(1);
    });
    it('builds a minimal veo request with no optional fields', () => {
        const req = buildVideoRequest({ cap: VEO, input: { prompt: 'a bird' } });
        expect(req.body.generate_audio).toBeUndefined();
        expect(req.body.seed).toBeUndefined();
    });
});

describe('buildVideoRequest — generic family', () => {
    it('builds a generic request with a snapped size, resolution, and reference', () => {
        const req = buildVideoRequest({ cap: GENERIC, input: {
                prompt: 'a fish',
                size: '1024x1024',
                resolution: 'hd',
                imageRef: { dataUrl: 'data:image/png;base64,AAA' },
                generateAudio: true,
                seed: 3,
            } });
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
        const req = buildVideoRequest({ cap: cap, input: { prompt: 'a fish' } });
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
        const req = buildVideoRequest({ cap: cap, input: {
                prompt: 'a fish',
                passthrough: { style: 'anime', notAllowed: 'nope' },
            } });
        expect(req.body.watermark).toBe(false);
        expect(req.body.style).toBe('anime');
        expect(req.body.notAllowed).toBeUndefined();
    });
    it('skips a passthrough key whose value is undefined', () => {
        const cap: ModelCapability = { ...GENERIC, allowedPassthroughParameters: ['style'] };
        const req = buildVideoRequest({ cap: cap, input: { prompt: 'a fish', passthrough: { style: undefined } } });
        expect('style' in req.body).toBe(false);
    });
    it('does nothing when the model declares no extraBodyDefaults/allowedPassthroughParameters', () => {
        const req = buildVideoRequest({ cap: GENERIC, input: { prompt: 'a fish', passthrough: { style: 'anime' } } });
        expect(req.body.style).toBeUndefined();
    });
});

describe('normalizeVideoResponse', () => {
    it('reads id/status/url/error from the top level', () => {
        expect(normalizeVideoResponse({ raw: { id: 't1', status: 'done', video_url: 'https://x/y.mp4' } })).toEqual({
            id: 't1',
            status: 'done',
            url: 'https://x/y.mp4',
        });
    });
    it('falls back to task_id and nested data.id/data.status', () => {
        expect(normalizeVideoResponse({ raw: { task_id: 't2', data: { status: 'running' } } })).toEqual({
            id: 't2',
            status: 'running',
        });
        expect(normalizeVideoResponse({ raw: { data: { id: 't3', task_id: 't4' } } })).toEqual({ id: 't3' });
    });
    it('reads url from url/output_url/data.video_url/data.url/data[0].url/unsigned_urls[0]', () => {
        expect(normalizeVideoResponse({ raw: { url: 'https://x/1.mp4' } }).url).toBe('https://x/1.mp4');
        expect(normalizeVideoResponse({ raw: { output_url: 'https://x/2.mp4' } }).url).toBe('https://x/2.mp4');
        expect(normalizeVideoResponse({ raw: { data: { video_url: 'https://x/3.mp4' } } }).url).toBe('https://x/3.mp4');
        expect(normalizeVideoResponse({ raw: { data: { url: 'https://x/4.mp4' } } }).url).toBe('https://x/4.mp4');
        expect(normalizeVideoResponse({ raw: { data: [{ url: 'https://x/5.mp4' }] } }).url).toBe('https://x/5.mp4');
        expect(normalizeVideoResponse({ raw: { unsigned_urls: ['https://x/6.mp4'] } }).url).toBe('https://x/6.mp4');
    });
    it('reads error from error.message, a string error, failure_reason, or message', () => {
        expect(normalizeVideoResponse({ raw: { error: { message: 'boom' } } }).error).toBe('boom');
        expect(normalizeVideoResponse({ raw: { error: 'boom-string' } }).error).toBe('boom-string');
        expect(normalizeVideoResponse({ raw: { failure_reason: 'boom-reason' } }).error).toBe('boom-reason');
        expect(normalizeVideoResponse({ raw: { message: 'boom-message' } }).error).toBe('boom-message');
    });
    it('returns an empty object for an empty/nullish input', () => {
        expect(normalizeVideoResponse({ raw: {} })).toEqual({});
        expect(normalizeVideoResponse({ raw: null })).toEqual({});
        expect(normalizeVideoResponse({ raw: undefined })).toEqual({});
    });
    it('returns an empty object when data is an empty array (no [0] to read)', () => {
        expect(normalizeVideoResponse({ raw: { data: [] } })).toEqual({});
    });
});

describe('buildVideoRequest — refactor pins (exact wire body incl. key order)', () => {
    const REF = { dataUrl: 'data:image/png;base64,AAAA' };
    it('seedance: full optional set serializes in a fixed key order', () => {
        const req = buildVideoRequest({ cap: SEEDANCE, input: { prompt: 'p', durationSeconds: 8, aspectRatio: '16:9', generateAudio: false, seed: 0, size: '1920x1080' } });
        expect(JSON.stringify(req.body)).toBe(JSON.stringify({ model: 'doubao-seedance-2-0-260128', prompt: 'p', duration: 8, content: [{ type: 'text', text: 'p' }], resolution: '1080p', ratio: '16:9', generate_audio: false, seed: 0 }));
    });
    it('seedance: omits ratio/generate_audio/seed when not supplied', () => {
        const req = buildVideoRequest({ cap: SEEDANCE, input: { prompt: 'p' } });
        expect(Object.keys(req.body)).toEqual(['model', 'prompt', 'duration', 'content', 'resolution']);
    });
    it('wan: full optional set serializes in a fixed key order with an upper-cased resolution', () => {
        const req = buildVideoRequest({ cap: WAN, input: { prompt: 'p', imageRef: REF, aspectRatio: '9:16', seed: 0, resolution: '480p', generateAudio: true } });
        expect(JSON.stringify(req.body)).toBe(JSON.stringify({ model: 'wan2.5-t2v-preview', input: { prompt: 'p', media: [{ type: 'first_frame', url: REF.dataUrl }] }, parameters: { resolution: '480P', duration: 5, prompt_extend: true, watermark: false, aspect_ratio: '9:16', seed: 0 } }));
    });
    it('wan: ignores generateAudio and omits media/aspect_ratio/seed when not supplied', () => {
        const req = buildVideoRequest({ cap: WAN, input: { prompt: 'p', generateAudio: true } });
        expect(req.body).toEqual({ model: 'wan2.5-t2v-preview', input: { prompt: 'p' }, parameters: { resolution: '720P', duration: 5, prompt_extend: true, watermark: false } });
    });
    it('veo: generate_audio false and seed 0 are kept, in a fixed key order', () => {
        const req = buildVideoRequest({ cap: VEO, input: { prompt: 'p', generateAudio: false, seed: 0, aspectRatio: '1:1', resolution: '1080p', imageRef: REF } });
        expect(JSON.stringify(req.body)).toBe(JSON.stringify({ model: 'veo-3.1-generate-preview', prompt: 'p', seconds: 4, size: '1280x720', generate_audio: false, seed: 0 }));
        expect(req.hasReference).toBe(true);
    });
    it('generic: full optional set serializes in a fixed key order with string seconds', () => {
        const req = buildVideoRequest({ cap: GENERIC, input: { prompt: 'p', size: '720x1280', resolution: 'hd', imageRef: REF, generateAudio: true, seed: 3, aspectRatio: '1:1', durationSeconds: 20 } });
        expect(JSON.stringify(req.body)).toBe(JSON.stringify({ model: 'sora-2', prompt: 'p', seconds: '12', size: '720x1280', resolution: 'hd', input_reference: REF.dataUrl, generate_audio: true, seed: 3 }));
    });
    it('generic: omits resolution/input_reference/generate_audio/seed when not supplied', () => {
        const req = buildVideoRequest({ cap: GENERIC, input: { prompt: 'p' } });
        expect(req.body).toEqual({ model: 'sora-2', prompt: 'p', seconds: '5', size: '1280x720' });
    });
    it('an empty-string imageRef dataUrl counts as no reference', () => {
        const req = buildVideoRequest({ cap: GENERIC, input: { prompt: 'p', imageRef: { dataUrl: '' } } });
        expect(req.hasReference).toBe(false);
        expect('input_reference' in req.body).toBe(false);
    });
    it('returns the fixed path/content-type envelope', () => {
        const req = buildVideoRequest({ cap: VEO, input: { prompt: 'p' } });
        expect(req).toMatchObject({ wireModel: 'veo-3.1-generate-preview', family: 'veo', pathSuffix: '/videos', contentType: 'application/json', hasReference: false });
    });
    it('extraBodyDefaults overwrite a builder field in place, skip undefined defaults, and append new keys', () => {
        const cap: ModelCapability = { ...VEO, extraBodyDefaults: [{ name: 'seconds', type: 'number', default: 99 }, { name: 'skipped', type: 'string' }, { name: 'tail', type: 'string', default: 't' }] };
        const req = buildVideoRequest({ cap, input: { prompt: 'p' } });
        expect(JSON.stringify(req.body)).toBe(JSON.stringify({ model: 'veo-3.1-generate-preview', prompt: 'p', seconds: 99, size: '1280x720', tail: 't' }));
    });
    it('an allowed passthrough value overrides both a builder field and an extraBodyDefault', () => {
        const cap: ModelCapability = { ...VEO, extraBodyDefaults: [{ name: 'seed', type: 'number', default: 1 }], allowedPassthroughParameters: ['seed'] };
        const req = buildVideoRequest({ cap, input: { prompt: 'p', seed: 5, passthrough: { seed: 7 } } });
        expect(req.body.seed).toBe(7);
    });
    it('an empty allowedPassthroughParameters list drops all passthrough', () => {
        const cap: ModelCapability = { ...VEO, allowedPassthroughParameters: [] };
        const req = buildVideoRequest({ cap, input: { prompt: 'p', passthrough: { style: 'x' } } });
        expect('style' in req.body).toBe(false);
    });
    it('an allowlist with no passthrough supplied leaves the body untouched', () => {
        const cap: ModelCapability = { ...VEO, allowedPassthroughParameters: ['style'] };
        const req = buildVideoRequest({ cap, input: { prompt: 'p' } });
        expect(Object.keys(req.body)).toEqual(['model', 'prompt', 'seconds', 'size']);
    });
});

describe('normalizeVideoResponse — refactor pins', () => {
    it('prefers top-level id over task_id over data.id over data.task_id', () => {
        expect(normalizeVideoResponse({ raw: { id: 'a', task_id: 'b', data: { id: 'c', task_id: 'd' } } }).id).toBe('a');
        expect(normalizeVideoResponse({ raw: { task_id: 'b', data: { id: 'c', task_id: 'd' } } }).id).toBe('b');
        expect(normalizeVideoResponse({ raw: { data: { id: 'c', task_id: 'd' } } }).id).toBe('c');
        expect(normalizeVideoResponse({ raw: { data: { task_id: 'd' } } }).id).toBe('d');
    });
    it('skips null at one level and falls through to the next', () => {
        expect(normalizeVideoResponse({ raw: { id: null, task_id: 'b', status: null, data: { status: 'running' } } })).toEqual({ id: 'b', status: 'running' });
    });
    it('stringifies non-string values, keeping falsy-but-present ones like 0 and false', () => {
        expect(normalizeVideoResponse({ raw: { id: 0, status: false, url: 42, error: { message: 0 } } })).toEqual({ id: '0', status: 'false', url: '42', error: '0' });
    });
    it('stringifies an object url to "[object Object]" (reported, not fixed)', () => {
        // A vendor that nests the url one level deeper yields an unusable string, not undefined.
        expect(normalizeVideoResponse({ raw: { url: { href: 'https://x' } } }).url).toBe('[object Object]');
    });
    it('url precedence: video_url, url, output_url, data.video_url, data.url, data[0].url, unsigned_urls[0]', () => {
        const full = { video_url: 'a', url: 'b', output_url: 'c', unsigned_urls: ['g'] };
        expect(normalizeVideoResponse({ raw: full }).url).toBe('a');
        expect(normalizeVideoResponse({ raw: { url: 'b', output_url: 'c' } }).url).toBe('b');
        expect(normalizeVideoResponse({ raw: { output_url: 'c', data: { video_url: 'd' } } }).url).toBe('c');
        expect(normalizeVideoResponse({ raw: { data: { video_url: 'd', url: 'e' } } }).url).toBe('d');
        expect(normalizeVideoResponse({ raw: { data: { url: 'e' } } }).url).toBe('e');
        expect(normalizeVideoResponse({ raw: { data: [{ url: 'f' }], unsigned_urls: ['g'] } }).url).toBe('f');
        expect(normalizeVideoResponse({ raw: { unsigned_urls: ['g'] } }).url).toBe('g');
    });
    it('ignores a non-array unsigned_urls', () => {
        expect(normalizeVideoResponse({ raw: { unsigned_urls: 'g' } })).toEqual({});
    });
    it('an error object without a message falls through to failure_reason, then message', () => {
        expect(normalizeVideoResponse({ raw: { error: { code: 1 }, failure_reason: 'fr', message: 'm' } }).error).toBe('fr');
        expect(normalizeVideoResponse({ raw: { error: { code: 1 }, message: 'm' } }).error).toBe('m');
    });
    it('error.message wins over failure_reason and message', () => {
        expect(normalizeVideoResponse({ raw: { error: { message: 'em' }, failure_reason: 'fr', message: 'm' } }).error).toBe('em');
    });
    it('a null error falls through to failure_reason', () => {
        expect(normalizeVideoResponse({ raw: { error: null, failure_reason: 'fr' } }).error).toBe('fr');
    });
    it('a primitive raw yields an empty result', () => {
        expect(normalizeVideoResponse({ raw: 'not-an-object' })).toEqual({});
    });
    it('emits keys in id, status, url, error order', () => {
        expect(Object.keys(normalizeVideoResponse({ raw: { message: 'e', url: 'u', status: 's', id: 'i' } }))).toEqual(['id', 'status', 'url', 'error']);
    });
});
