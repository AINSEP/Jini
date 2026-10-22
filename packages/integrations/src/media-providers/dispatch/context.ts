/**
 * Builds the per-generation `RenderContext` threaded into every `render*`
 * provider function. Pulled out of `engine.ts`'s dispatch flow into its own
 * pure function specifically so it can be unit-tested directly — several of
 * its fields (`promptInfluence`, `imageRefs`) aren't consumed by any vendor
 * ported so far in this pass, so the only way to prove their computation is
 * correct without a real renderer to observe them through is to test this
 * function's return value directly, rather than leave them untested or
 * drop them from the type surface. See `archived provenance ledger` for why both fields
 * are kept despite having no current consumer.
 */
import type { AudioKind, MediaSurface } from '../types.js';
import { resolveSpeechFormat } from './openai-compatible.js';
import type { MediaGenerationRequest, RenderContext } from './types.js';

function defaultAspectFor(surface: MediaSurface): string | undefined {
  if (surface === 'image') return '1:1';
  if (surface === 'video') return '16:9';
  return undefined;
}

/** Never forward a non-finite number (NaN/Infinity) to a provider. */
function finiteOrUndefined(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** An explicit `imageRefs` wins; otherwise derive a one-element list from `imageRef`. */
function resolveImageRefs(request: MediaGenerationRequest): RenderContext['imageRefs'] {
  return request.imageRefs ?? (request.imageRef ? [request.imageRef] : []);
}

/**
 * @param request The caller's original request.
 * @param resolvedAudioKind Already resolved by the caller (defaults to `'music'` for an audio surface with no explicit `audioKind`).
 * @param length Already clamped by the caller (video surface only).
 * @param duration Already clamped by the caller (audio surface only).
 */
export function buildRenderContext({ request, resolvedAudioKind, length, duration }: { request: MediaGenerationRequest; resolvedAudioKind: AudioKind | undefined; length: number | undefined; duration: number | undefined }
): RenderContext {
  return {
    surface: request.surface,
    model: request.model,
    wireModel: request.wireModel ?? request.model,
    prompt: request.prompt || '',
    aspect: request.aspect || defaultAspectFor(request.surface),
    length,
    duration,
    voice: request.voice || '',
    audioKind: resolvedAudioKind,
    language: request.language || '',
    loop: request.loop === true,
    promptInfluence: finiteOrUndefined(request.promptInfluence),
    imageRef: request.imageRef ?? null,
    imageRefs: resolveImageRefs(request),
    requestInit: request.requestInit || {},
    speechFormat: resolveSpeechFormat(request.speechFormat),
    onProgress: request.onProgress,
  };
}
