/**
 * Pure video request builder over CapabilityRegistry's ModelCapability data.
 * No fetch or auth — the caller resolves any reference image
 * to a data URL beforehand and attaches auth + base URL afterward; this
 * module only shapes the request body per vendor wire family:
 *
 *   • `seedance` (ByteDance Ark) — multimodal `content[]` array (text +
 *     image_url{url,role:first_frame}); duration/ratio/resolution fields.
 *   • `wan` (Alibaba DashScope/wanx-backed) —
 *     `{ input:{ prompt, media[] }, parameters:{ resolution, duration, ... } }`.
 *   • `veo` (Google Veo via a Gemini predictLongRunning shim) — flat JSON;
 *     `seconds` MUST be a number and the only size hint is `size`.
 *   • `generic` (Sora and similar) — flat JSON with `seconds` as a string.
 *
 * Duration/ratio/resolution snapping follows the vendor-specific constraints documented at
 * each function, rather than generic defaults.
 */
import type { BuiltVideoRequest, MediaFamily, ModelCapability, NormalizedVideoResponse, VideoBuildInput } from './types.js';

/** Resolves the upstream model name: the i2v variant when a reference image is present. */
export function resolveWireModel({ cap, hasReference }: { cap: ModelCapability; hasReference: boolean }): string {
  return hasReference && cap.apiModelI2V ? cap.apiModelI2V : cap.apiModel;
}

/** Derives the request family from the resolved upstream model name (or an explicit `cap.family` override). */
export function deriveVideoFamily({ wireModel }: { wireModel: string }, { cap }: { cap?: ModelCapability | undefined } = {}): MediaFamily {
  if (cap?.family) return cap.family;
  const m = wireModel.toLowerCase();
  if (m.startsWith('doubao-seedance-')) return 'seedance';
  if (m.startsWith('wan') || m.startsWith('happyhorse')) return 'wan';
  if (m.startsWith('veo')) return 'veo';
  return 'generic';
}

/**
 * Snaps a requested duration to the model's allowed set (e.g. Veo 4/6/8, wan
 * 5/10). Falls back to a 3-12 clamp when the model declares no constraint.
 * Ties prefer the shorter value (array order wins on an exact tie distance).
 */
export function snapDuration({ cap, requested }: { cap: ModelCapability; requested: number | undefined }): number {
  const req = Number.isFinite(requested) ? (requested as number) : 5;
  const allowed = cap.supportedDurations;
  if (!allowed || allowed.length === 0) {
    return Math.min(12, Math.max(3, Math.round(req)));
  }
  return allowed.reduce((best, v) => (Math.abs(v - req) < Math.abs(best - req) ? v : best), allowed[0]!);
}

/**
 * Seedance and wan accept resolution only as a quality token
 * (`480p`/`720p`/`1080p`), never a `WxH` pixel string. Normalizes whichever
 * the caller supplied to the nearest lowercase token by short side
 * (720→720p, 1080→1080p, ...); defaults to `720p` when nothing usable is
 * supplied. (The `wan` family upper-cases the result itself.)
 */
export function snapResolutionToken({ resolution, size }: { resolution: string | undefined; size: string | undefined }): string {
  const token = (resolution || '').trim().toLowerCase();
  if (/^(480|720|1080)p$/.test(token)) return token;
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec((size || resolution || '').trim());
  if (m) {
    const shortSide = Math.min(parseInt(m[1]!, 10), parseInt(m[2]!, 10));
    if (shortSide <= 480) return '480p';
    if (shortSide <= 720) return '720p';
    return '1080p';
  }
  return '720p';
}

const VEO_VALID_SIZES = new Set(['1280x720', '720x1280', '1920x1080', '1080x1920']);

/**
 * Veo (via the verified gateway's Gemini predictLongRunning shim) only
 * accepts a handful of `size` values — anything mapping outside 720p/1080p
 * (e.g. a 1:1 `1024x1024`) 400s. Snaps to the nearest valid Veo size by
 * orientation; defaults to landscape 720p.
 */
export function snapVeoSize({ size }: { size: string | undefined }): string {
  const s = (size || '').trim().toLowerCase().replace('×', 'x');
  if (VEO_VALID_SIZES.has(s)) return s;
  const m = /^(\d+)\s*x\s*(\d+)$/.exec(s);
  if (m) return parseInt(m[2]!, 10) > parseInt(m[1]!, 10) ? '720x1280' : '1280x720';
  return '1280x720';
}

/**
 * Snaps a requested `size` to the model's declared `supportedSizes` by
 * orientation (portrait matches portrait, else landscape). Returns the size
 * unchanged when the model declares no constraint; falls back to the first
 * supported size when the input is missing/unparseable.
 */
export function snapSizeToSupported({ size, supported }: { size: string | undefined; supported: readonly string[] | undefined }): string | undefined {
  if (!supported || supported.length === 0) return size;
  const norm = (v: string) => v.trim().toLowerCase().replace('×', 'x');
  const s = norm(size || '');
  const exact = supported.find((v) => norm(v) === s);
  if (exact) return exact;
  const dims = /^(\d+)\s*x\s*(\d+)$/.exec(s);
  const portrait = dims ? parseInt(dims[2]!, 10) > parseInt(dims[1]!, 10) : false;
  const match = supported.find((v) => {
    const vm = /^(\d+)\s*x\s*(\d+)$/.exec(norm(v));
    return vm ? parseInt(vm[2]!, 10) > parseInt(vm[1]!, 10) === portrait : false;
  });
  return match || supported[0];
}

/** Applies `extraBodyDefaults`, then overlays caller passthrough filtered by `allowedPassthroughParameters`. */
function mergeExtraBody(body: Record<string, unknown>, cap: ModelCapability, passthrough: Readonly<Record<string, unknown>> | undefined): void {
  for (const def of cap.extraBodyDefaults ?? []) {
    if (def.default !== undefined) body[def.name] = def.default;
  }
  if (passthrough && cap.allowedPassthroughParameters?.length) {
    applyAllowedPassthrough(body, new Set(cap.allowedPassthroughParameters), passthrough);
  }
}

function applyAllowedPassthrough(body: Record<string, unknown>, allow: ReadonlySet<string>, passthrough: Readonly<Record<string, unknown>>): void {
  for (const [k, v] of Object.entries(passthrough)) {
    if (allow.has(k) && v !== undefined) body[k] = v;
  }
}

/** Builds the seedance multimodal content array (text + reference images). */
function buildSeedanceContent(input: VideoBuildInput): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }];
  if (input.imageRef?.dataUrl) {
    content.push({ type: 'image_url', image_url: { url: input.imageRef.dataUrl }, role: 'first_frame' });
  }
  for (const ref of input.extraImageRefs ?? []) {
    if (ref?.dataUrl) {
      content.push({ type: 'image_url', image_url: { url: ref.dataUrl }, role: 'reference_image' });
    }
  }
  return content;
}

/** What every family body builder needs, resolved once by `buildVideoRequest`. */
interface FamilyBodyArgs {
  readonly cap: ModelCapability;
  readonly input: VideoBuildInput;
  readonly wireModel: string;
  readonly seconds: number;
  /** The reference image's data URL; undefined or empty means there is no reference. */
  readonly referenceUrl: string | undefined;
}

/** `generate_audio` (only a real boolean) then `seed` (only a real number), in that wire order. */
function audioAndSeed(input: VideoBuildInput): Record<string, unknown> {
  return {
    ...(typeof input.generateAudio === 'boolean' ? { generate_audio: input.generateAudio } : {}),
    ...seedField(input),
  };
}

function seedField(input: VideoBuildInput): Record<string, unknown> {
  return typeof input.seed === 'number' ? { seed: input.seed } : {};
}

function buildSeedanceBody({ input, wireModel, seconds }: FamilyBodyArgs): Record<string, unknown> {
  return {
    model: wireModel,
    prompt: input.prompt,
    duration: seconds,
    content: buildSeedanceContent(input),
    resolution: snapResolutionToken({ resolution: input.resolution, size: input.size }),
    ...(input.aspectRatio ? { ratio: input.aspectRatio } : {}),
    ...audioAndSeed(input),
  };
}

function buildWanBody({ input, wireModel, seconds, referenceUrl }: FamilyBodyArgs): Record<string, unknown> {
  return {
    model: wireModel,
    input: {
      prompt: input.prompt,
      ...(referenceUrl ? { media: [{ type: 'first_frame', url: referenceUrl }] } : {}),
    },
    parameters: {
      resolution: snapResolutionToken({ resolution: input.resolution, size: input.size }).toUpperCase(),
      duration: seconds,
      prompt_extend: true,
      watermark: false,
      ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
      ...seedField(input),
    },
  };
}

function buildVeoBody({ input, wireModel, seconds }: FamilyBodyArgs): Record<string, unknown> {
  return {
    model: wireModel,
    prompt: input.prompt,
    seconds,
    size: snapVeoSize({ size: input.size }),
    ...audioAndSeed(input),
  };
}

function buildGenericBody({ cap, input, wireModel, seconds, referenceUrl }: FamilyBodyArgs): Record<string, unknown> {
  const genericSize = snapSizeToSupported({ size: input.size, supported: cap.supportedSizes });
  return {
    model: wireModel,
    prompt: input.prompt,
    seconds: String(seconds),
    ...(genericSize ? { size: genericSize } : {}),
    ...(input.resolution ? { resolution: input.resolution } : {}),
    ...(referenceUrl ? { input_reference: referenceUrl } : {}),
    ...audioAndSeed(input),
  };
}

const FAMILY_BODY_BUILDERS: Readonly<Record<MediaFamily, (args: FamilyBodyArgs) => Record<string, unknown>>> = {
  seedance: buildSeedanceBody,
  wan: buildWanBody,
  veo: buildVeoBody,
  generic: buildGenericBody,
};

/**
 * An unrecognized `cap.family` (untyped host config) gets the generic body,
 * as the original if/else chain's final `else` did. `Object.hasOwn` keeps a
 * prototype key such as `"toString"` from resolving to a non-builder.
 */
function bodyBuilderFor(family: MediaFamily): (args: FamilyBodyArgs) => Record<string, unknown> {
  return Object.hasOwn(FAMILY_BODY_BUILDERS, family) ? FAMILY_BODY_BUILDERS[family] : buildGenericBody;
}

/**
 * Builds the upstream video request body for a model. Pure: no fetch, no
 * auth. Caller: `POST \`${baseUrl}${pathSuffix}\`` with auth headers +
 * `JSON.stringify(body)`.
 */
export function buildVideoRequest({ cap, input }: { cap: ModelCapability; input: VideoBuildInput }): BuiltVideoRequest {
  const referenceUrl = input.imageRef?.dataUrl;
  const hasReference = Boolean(referenceUrl);
  const wireModel = resolveWireModel({ cap, hasReference });
  const family = deriveVideoFamily({ wireModel }, { cap });
  const seconds = snapDuration({ cap, requested: input.durationSeconds });

  const body = bodyBuilderFor(family)({ cap, input, wireModel, seconds, referenceUrl });
  mergeExtraBody(body, cap, input.passthrough);

  return { wireModel, family, pathSuffix: '/videos', contentType: 'application/json', body, hasReference };
}

/** The first value that is neither `undefined` nor `null` — a `??` chain over a list. */
function firstPresent(...values: readonly unknown[]): unknown {
  return values.find((v) => v !== undefined && v !== null);
}

/** `error.message` (object form), the string `error`, then `failure_reason`, then `message`. */
function responseError(d: Record<string, unknown>): unknown {
  const errorObj = d.error as Record<string, unknown> | string | undefined;
  const fromObject = typeof errorObj === 'object' && errorObj ? errorObj.message : undefined;
  const fromString = typeof errorObj === 'string' ? errorObj : undefined;
  return firstPresent(fromObject, fromString, d.failure_reason, d.message);
}

function responseUrl(d: Record<string, unknown>, data: Record<string, unknown> | undefined): unknown {
  const dataArray = Array.isArray(d.data) ? (d.data as Array<Record<string, unknown>>) : undefined;
  const unsignedUrls = Array.isArray(d.unsigned_urls) ? (d.unsigned_urls as unknown[]) : undefined;
  return firstPresent(d.video_url, d.url, d.output_url, data?.video_url, data?.url, dataArray?.[0]?.url, unsignedUrls?.[0]);
}

/** Best-effort normalization of an async-submit / poll response across vendor families. */
export function normalizeVideoResponse({ raw }: { raw: unknown }): NormalizedVideoResponse {
  const d = (raw ?? {}) as Record<string, unknown>;
  const data = d.data as Record<string, unknown> | undefined;
  const fields = {
    id: firstPresent(d.id, d.task_id, data?.id, data?.task_id),
    status: firstPresent(d.status, data?.status),
    url: responseUrl(d, data),
    error: responseError(d),
  };
  const result: { -readonly [K in keyof NormalizedVideoResponse]: string } = {};
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    if (fields[key] !== undefined) result[key] = String(fields[key]);
  }
  return result;
}
