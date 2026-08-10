/**
 * Reference capability seed data, ported verbatim from OD's
 * `apps/daemon/src/media-adapters/seed.ts` (itself sourced from AIHubMix's
 * `lib/models.ts` + DB, per that file's own header comment). Every field
 * here is real vendor model behavior verified against a live upstream call
 * (see the inline notes) — reference data, not product identity.
 *
 * Consumers should go through `createCapabilityRegistry(MEDIA_CAPABILITY_SEED)`
 * rather than importing this directly, so a future live-fetched catalogue is
 * a local swap (see `capability-registry.ts`).
 */
import type { ModelCapability } from './types.js';

export const MEDIA_CAPABILITY_SEED: readonly ModelCapability[] = [
  // ── ByteDance Seedance (Volcengine Ark) — multimodal content[] array ─────
  {
    id: 'doubao-seedance-2-0-260128',
    apiModel: 'doubao-seedance-2-0-260128',
    mediaType: 'video',
    family: 'seedance',
    caps: ['t2v', 'i2v'],
    supportedFrameImages: ['first_frame', 'reference_image'],
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    generateAudio: true,
    seed: true,
  },
  {
    id: 'doubao-seedance-2-0-fast-260128',
    apiModel: 'doubao-seedance-2-0-fast-260128',
    mediaType: 'video',
    family: 'seedance',
    caps: ['t2v', 'i2v'],
    supportedFrameImages: ['first_frame', 'reference_image'],
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
  },

  // ── Alibaba Wan (DashScope/wanx wire: input.media + parameters) ──────────
  {
    id: 'wan2.5-t2v-preview',
    apiModel: 'wan2.5-t2v-preview',
    mediaType: 'video',
    family: 'wan',
    caps: ['t2v'],
    supportedDurations: [5, 10],
    supportedResolutions: ['480P', '720P', '1080P'],
  },
  {
    id: 'wan2.5-i2v-preview',
    apiModel: 'wan2.5-i2v-preview',
    mediaType: 'video',
    family: 'wan',
    caps: ['i2v'],
    supportedFrameImages: ['first_frame'],
    supportedDurations: [5, 10],
    supportedResolutions: ['480P', '720P', '1080P'],
  },
  {
    id: 'wan2.6-i2v',
    apiModel: 'wan2.6-i2v',
    mediaType: 'video',
    family: 'wan',
    caps: ['i2v'],
    supportedFrameImages: ['first_frame'],
    supportedResolutions: ['480P', '720P', '1080P'],
  },

  // ── OpenAI Sora — flat shape with input_reference ────────────────────────
  {
    id: 'sora-2',
    apiModel: 'sora-2',
    mediaType: 'video',
    family: 'generic',
    caps: ['t2v', 'i2v'],
    supportedFrameImages: ['first_frame'],
    supportedSizes: ['720x1280', '1280x720'],
    supportedDurations: [4, 8, 12],
  },
  {
    id: 'sora-2-pro',
    apiModel: 'sora-2-pro',
    mediaType: 'video',
    family: 'generic',
    caps: ['t2v', 'i2v'],
    supportedFrameImages: ['first_frame'],
    supportedSizes: ['720x1280', '1280x720', '1792x1024', '1024x1792'],
    supportedDurations: [4, 8, 12],
  },

  // ── Google Veo — own `veo` family (Gemini predictLongRunning shim) ───────
  // Text-to-video only on the verified gateway: a reference image in any
  // accepted form 400s with "inlineData/referenceImages isn't supported by
  // this model", so no i2v cap/frame images here. `seconds` must be a NUMBER;
  // only `size` is honoured (no aspect_ratio). Veo accepts 4/6/8 seconds only.
  {
    id: 'veo-3.1-generate-preview',
    apiModel: 'veo-3.1-generate-preview',
    mediaType: 'video',
    family: 'veo',
    caps: ['t2v'],
    supportedDurations: [4, 6, 8],
  },
  {
    id: 'veo-3.1-lite-generate-preview',
    apiModel: 'veo-3.1-lite-generate-preview',
    mediaType: 'video',
    family: 'veo',
    caps: ['t2v'],
    supportedDurations: [4, 6, 8],
  },

  // ── HappyHorse (Alibaba, DashScope/wanx-backed) ──────────────────────────
  // Verified against a working call: uses the DashScope wanx wire —
  // { input:{ prompt, media:[{type:first_frame,url}] }, parameters:{...} } —
  // not the flat input_reference shape, so it routes through the `wan` family.
  {
    id: 'happyhorse-1.0-i2v',
    apiModel: 'happyhorse-1.0-i2v',
    mediaType: 'video',
    family: 'wan',
    caps: ['i2v'],
    supportedFrameImages: ['first_frame'],
    supportedDurations: [5],
    supportedResolutions: ['480P', '720P', '1080P'],
  },
];
