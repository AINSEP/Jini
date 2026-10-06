import { describe, expect, it } from 'vitest';
import { planVideoFrames, parseVideoProbe, getVideoFrameEdge, planVideoContactSheets } from '../video-frames.js';

// Contract: 2026-10-06-release-0111-video64/staged/spec.md. No codec executable is used by unit tests.
// Spec SHA256: 855beddf17d8f9a6a7f7974a54d3ca396fb8eab2a9e0bb3ed49b59a7bad6939d.
describe('video sampling', () => {
  it('spaces sixteen frames near the start and end by default', () => {
    const times = planVideoFrames({ duration: 10 }, {});
    expect(times).toHaveLength(16);
    expect(times[0]).toBe(0.1);
    expect(times[15]).toBe(9.9);
    expect(times[1]! - times[0]!).toBeCloseTo(times[2]! - times[1]!);
  });
  it('clamps frame count, uses midpoint for one and handles tiny clips', () => {
    expect(planVideoFrames({ duration: 10 }, { frames: 99 })).toHaveLength(64);
    expect(planVideoFrames({ duration: 10 }, { frames: 0 })).toEqual([5]);
    expect(planVideoFrames({ duration: 10 }, { frames: 2.8 })).toEqual([0.1, 9.9]);
    const tiny = planVideoFrames({ duration: 0.01 }, {});
    expect(tiny).toHaveLength(16);
    expect(tiny.every(t => t >= 0 && t < 0.01)).toBe(true);
  });
  it('at overrides count and start, clamps timestamps and caps to sixty-four in supplied order', () => {
    expect(planVideoFrames({ duration: 10 }, { frames: 1, start: 7, at: [20, 2, 0, 2] })).toEqual([9.9, 2, 0, 2]);
    expect(planVideoFrames({ duration: 10 }, { at: Array(80).fill(1) })).toHaveLength(64);
    for (const optional of [{ at: [] }, { at: [NaN] }, { at: [Infinity] }, { frames: NaN }]) {
      expect(() => planVideoFrames({ duration: 10 }, optional)).toThrow();
    }
    expect(() => planVideoFrames({ duration: 0 }, {})).toThrow();
  });
  it('uses the requested gap and count from zero or an explicit starting time', () => {
    expect(planVideoFrames({ duration: 10 }, { every: 0.5, frames: 4 })).toEqual([0, 0.5, 1, 1.5]);
    expect(planVideoFrames({ duration: 10 }, { every: 0.5, start: 2, frames: 3 })).toEqual([2, 2.5, 3]);
    expect(planVideoFrames({ duration: 10 }, { every: 2, start: 1, frames: 1 })).toEqual([1]);
    expect(planVideoFrames({ duration: 10 }, { every: 2, frames: 2.8 })).toEqual([0, 2]);
  });
  it('fills only times that fit when count is omitted, with a cap of sixty-four', () => {
    expect(planVideoFrames({ duration: 2 }, { every: 0.5 })).toEqual([0, 0.5, 1, 1.5]);
    expect(planVideoFrames({ duration: 2 }, { every: 0.5, start: 1 })).toEqual([1, 1.5]);
    expect(planVideoFrames({ duration: 40 }, { every: 0.5 })).toEqual(Array.from({ length: 64 }, (_, index) => index / 2));
    expect(planVideoFrames({ duration: 10 }, { every: 0.01, frames: 99 })).toHaveLength(64);
    expect(planVideoFrames({ duration: 10 }, { every: 20 })).toEqual([0]);
  });
  it('clamps explicit counts near EOF and starts beyond the clip without unbounded loops', () => {
    expect(planVideoFrames({ duration: 10 }, { every: 1, start: 9, frames: 3 })).toEqual([9, 9.9, 9.9]);
    expect(planVideoFrames({ duration: 10 }, { every: 1, start: 20 })).toEqual([9.9]);
    expect(planVideoFrames({ duration: 10 }, { every: 1, start: 20, frames: 2 })).toEqual([9.9, 9.9]);
    const tiny = planVideoFrames({ duration: 0.01 }, { every: 0.002, frames: 6 });
    expect(tiny.slice(0, 5)).toEqual([0, 0.002, 0.004, 0.006, 0.008]);
    expect(tiny).toHaveLength(6);
    expect(tiny[5]).toBeCloseTo(0.009, 12);
    expect(planVideoFrames({ duration: 10 }, { every: Number.MIN_VALUE })).toHaveLength(64);
    expect(planVideoFrames({ duration: 10 }, { every: Number.MAX_VALUE })).toEqual([0]);
    expect(planVideoFrames({ duration: 10 }, { every: Number.MAX_VALUE, frames: 3 })).toEqual([0, 9.9, 9.9]);
  });
  it('includes a fitting boundary despite floating point rounding, without an extra EOF sample', () => {
    const times = planVideoFrames({ duration: 0.7 }, { every: 0.07 });
    expect(times).toHaveLength(10);
    expect(times[9]).toBeCloseTo(0.63, 12);
    expect(times.every(time => time <= 0.63)).toBe(true);
    expect(planVideoFrames({ duration: 0.7 }, { every: 0.070001 })).toHaveLength(9);
  });
  it('retains the default spread when only start is supplied', () => {
    expect(planVideoFrames({ duration: 10 }, { start: 3 })).toEqual(planVideoFrames({ duration: 10 }, {}));
  });
  it('refuses non-finite and negative options with exact messages, even when at overrides them', () => {
    for (const frames of [NaN, Infinity, -Infinity]) expect(() => planVideoFrames({ duration: 10 }, { frames })).toThrow(/^Frame count must be finite\.$/);
    expect(() => planVideoFrames({ duration: 10 }, { frames: -1 })).toThrow(/^Frame count must be nonnegative\.$/);
    for (const at of [[], [NaN], [Infinity], [-Infinity]]) expect(() => planVideoFrames({ duration: 10 }, { at })).toThrow(/^at must contain finite timestamps in seconds\.$/);
    expect(() => planVideoFrames({ duration: 10 }, { at: [-1] })).toThrow(/^at timestamps must be nonnegative\.$/);
    for (const every of [0, -1, NaN, Infinity, -Infinity]) expect(() => planVideoFrames({ duration: 10 }, { every })).toThrow(/^every must be a positive finite number of seconds\.$/);
    for (const start of [-1, NaN, Infinity, -Infinity]) expect(() => planVideoFrames({ duration: 10 }, { start })).toThrow(/^start must be a nonnegative finite number of seconds\.$/);
    expect(() => planVideoFrames({ duration: 10 }, { at: [0], every: 1 })).toThrow(/^every cannot be combined with at\.$/);
    expect(() => planVideoFrames({ duration: 10 }, { at: [0], frames: NaN })).toThrow(/^Frame count must be finite\.$/);
    expect(() => planVideoFrames({ duration: 10 }, { at: [0], start: -1 })).toThrow(/^start must be a nonnegative finite number of seconds\.$/);
  });
});

describe('ffprobe metadata', () => {
  it('uses the actual input size and distinguishes video and audio streams', () => {
    expect(parseVideoProbe({ output: JSON.stringify({ format: { duration: '2.5', format_name: 'mov,mp4,m4a,3gp,3g2,mj2', size: '999' }, streams: [
      { codec_type: 'audio', codec_name: 'aac' },
      { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
    ] }), sizeBytes: 123 }, {})).toEqual({ duration: 2.5, width: 1280, height: 720, codec: 'h264', container: 'mov,mp4,m4a,3gp,3g2,mj2', sizeBytes: 123, hasAudio: true });
  });
  it('falls back to stream duration and does not mistake cover art for a video', () => {
    expect(parseVideoProbe({ output: JSON.stringify({ streams: [
      { codec_type: 'video', width: 100, height: 100, disposition: { attached_pic: 1 } },
      { codec_type: 'video', duration: '1', width: 64, height: 32, codec_name: 'vp9' },
    ], format: { format_name: 'matroska,webm', duration: 'N/A' } }), sizeBytes: 42 }, {})).toMatchObject({ duration: 1, width: 64, height: 32, hasAudio: false });
  });
  it('rejects invalid/missing duration, dimensions, or video stream', () => {
    for (const output of ['{}', 'invalid JSON', JSON.stringify({ format: { duration: 'NaN' }, streams: [{ codec_type: 'video', width: 10, height: 10 }] }), JSON.stringify({ format: { duration: '1' }, streams: [{ codec_type: 'video', width: 0, height: 10 }] })]) {
      expect(() => parseVideoProbe({ output, sizeBytes: 42 }, {})).toThrow();
    }
  });
});


describe('video image cost policy', () => {
  it('keeps up to sixteen at 768px, shrinks above sixteen and reaches 384px at sixty-four', () => {
    for (const frameCount of [1, 4, 16]) expect(getVideoFrameEdge({ frameCount }, {})).toBe(768);
    expect(getVideoFrameEdge({ frameCount: 17 }, {})).toBe(744);
    expect(getVideoFrameEdge({ frameCount: 64 }, {})).toBe(384);
    let previous = 768;
    for (let frameCount = 1; frameCount <= 64; frameCount++) {
      const edge = getVideoFrameEdge({ frameCount }, {});
      expect(edge % 2).toBe(0);
      expect(edge).toBeLessThanOrEqual(previous);
      expect(frameCount * edge * edge / 750).toBeLessThanOrEqual(20_000);
      previous = edge;
    }
  });
  it('refuses invalid counts instead of allowing an unbounded size calculation', () => {
    for (const frameCount of [0, -1, 1.5, 65, NaN, Infinity]) {
      expect(() => getVideoFrameEdge({ frameCount }, {})).toThrow(/^Frame count must be an integer from 1 to 64\.$/);
    }
  });
});

describe('contact sheet planning', () => {
  it('uses row-major tiles with one-based positions, retaining unsorted and repeated timestamps', () => {
    const sheets = planVideoContactSheets({ times: [9, 2, 2, 0, 5] }, {});
    expect(sheets).toEqual([{ columns: 3, rows: 2, tileEdgePx: 768, tiles: [
      { index: 1, row: 1, column: 1, at: 9 }, { index: 2, row: 1, column: 2, at: 2 },
      { index: 3, row: 1, column: 3, at: 2 }, { index: 4, row: 2, column: 1, at: 0 },
      { index: 5, row: 2, column: 2, at: 5 },
    ] }]);
    expect(planVideoContactSheets({ times: [4] }, {})).toEqual([{ columns: 1, rows: 1, tileEdgePx: 768, tiles: [{ index: 1, row: 1, column: 1, at: 4 }] }]);
  });
  it('caps grids at four by four, emits up to four sheets and budgets blank cells too', () => {
    for (let count = 1; count <= 64; count++) {
      const times = Array.from({ length: count }, (_, index) => index / 2);
      const sheets = planVideoContactSheets({ times }, {});
      expect(sheets).toHaveLength(Math.ceil(count / 16));
      expect(sheets.flatMap(sheet => sheet.tiles.map(tile => tile.at))).toEqual(times);
      let pixels = 0;
      for (const sheet of sheets) {
        expect(sheet.columns).toBeLessThanOrEqual(4);
        expect(sheet.rows).toBeLessThanOrEqual(4);
        expect(sheet.tiles.length).toBeLessThanOrEqual(16);
        expect(sheet.tiles.length).toBeLessThanOrEqual(sheet.rows * sheet.columns);
        pixels += sheet.columns * sheet.rows * sheet.tileEdgePx ** 2;
      }
      expect(pixels / 750).toBeLessThanOrEqual(20_000);
    }
    const full = planVideoContactSheets({ times: Array.from({ length: 64 }, (_, index) => index) }, {});
    expect(full.map(sheet => [sheet.columns, sheet.rows, sheet.tileEdgePx])).toEqual(Array(4).fill([4, 4, 384]));
    const partial = planVideoContactSheets({ times: Array.from({ length: 19 }, (_, index) => index) }, {});
    expect(partial.map(sheet => [sheet.columns, sheet.rows, sheet.tiles.length])).toEqual([[4, 4, 16], [2, 2, 3]]);
    expect(partial[0]!.tileEdgePx).toBe(686); // Twenty grid cells, including one blank.
  });
  it('refuses empty, oversized and invalid timestamp lists', () => {
    for (const times of [[], Array(65).fill(0), [-1], [NaN], [Infinity]]) {
      expect(() => planVideoContactSheets({ times }, {})).toThrow();
    }
  });
});
