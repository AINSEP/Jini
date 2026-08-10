/**
 * Deterministic placeholder-bytes renderer used when
 * `MediaDispatchEngineOptions.allowStubFallback` is `true` and no real
 * renderer is wired up for a (provider, surface) pair — a labelled SVG/PNG,
 * silent WAV/MP3, or a minimal MP4 container, so a pipeline can be
 * exercised end-to-end before every vendor integration lands. Ported
 * near-verbatim from Open Design's `apps/daemon/src/media/index.ts`
 * `renderStub`/`svgPlaceholder`/`aspectToBox`/`silentWav` — see
 * `source-map.md`.
 */
import { truncate } from './openai-compatible.js';
import type { RenderContext, RenderResult } from './types.js';

export async function renderStub(ctx: RenderContext, providerId: string, integrated: boolean): Promise<RenderResult> {
  const note = !integrated ? `stub-${ctx.surface} · provider '${providerId}' integration pending` : `stub-${ctx.surface} · model=${ctx.model}`;
  if (ctx.surface === 'image') {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00,
      0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d,
      0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    return {
      bytes: png,
      providerNote: `${note} · aspect=${ctx.aspect} · prompt=${truncate(ctx.prompt, 60)}`,
      suggestedExt: '.png',
    };
  }
  if (ctx.surface === 'video') {
    const ftyp = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, 0x69, 0x73,
      0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
    ]);
    const mdat = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74]);
    return {
      bytes: Buffer.concat([ftyp, mdat]),
      providerNote: `${note} · aspect=${ctx.aspect} · length=${ctx.length ?? '?'}s · prompt=${truncate(ctx.prompt, 60)}`,
      suggestedExt: '.mp4',
    };
  }
  // Audio
  if (ctx.speechFormat === 'wav') {
    return {
      bytes: silentWav(0.5),
      providerNote: `${note} · kind=${ctx.audioKind} · duration=${ctx.duration ?? '?'}s`,
      suggestedExt: '.wav',
    };
  }
  const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  return {
    bytes: mp3,
    providerNote: `${note} · kind=${ctx.audioKind} · voice=${ctx.voice || '-'} · duration=${ctx.duration ?? '?'}s`,
    suggestedExt: '.mp3',
  };
}

/** Renders a labelled placeholder SVG for the image surface (an explicit opt-in alternative to the PNG placeholder). */
export function svgPlaceholder(ctx: RenderContext): string {
  const [w, h] = aspectToBox(ctx.aspect, 800);
  const safe = (s: unknown): string =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    `<rect width="${w}" height="${h}" fill="#0f1424"/>`,
    `<text x="50%" y="50%" fill="#7da4ff" font-family="ui-sans-serif" font-size="20" text-anchor="middle">${safe(ctx.model)} — ${safe(ctx.prompt).slice(0, 60)}</text>`,
    '</svg>',
  ].join('');
}

function aspectToBox(aspect: string | undefined, base: number): [number, number] {
  const [a, b] = String(aspect || '1:1')
    .split(':')
    .map(Number);
  if (!a || !b) return [base, base];
  if (a >= b) return [base, Math.round((base * b) / a)];
  return [Math.round((base * a) / b), base];
}

function silentWav(seconds: number): Buffer {
  const sampleRate = 8000;
  const numSamples = Math.max(1, Math.round(sampleRate * seconds));
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}
