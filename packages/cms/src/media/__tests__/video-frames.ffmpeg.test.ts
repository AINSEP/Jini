import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn } from 'node:child_process';
import { access, readdir, writeFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createFfmpegVideoFrameExtractor, runLowPriorityVideoProcess } from '../video-frames.ffmpeg.js';
import { VIDEO_EXTRACTION_TIMEOUT_MS, VIDEO_MAX_FRAME_BYTES, VIDEO_MAX_INPUT_BYTES, VIDEO_MAX_OUTPUT_BYTES, VIDEO_MAX_SHEET_BYTES } from '../video-frames.js';

// Contract: 2026-10-06-release-0111-video64b/spec.md.
// Spec SHA256: 33792c2bad891b94e381f33e2f0e2be4c830ab371107312245f2ba8b9fb284a8.
const mp4 = new Uint8Array([0, 0, 0, 24, ...Buffer.from('ftypisom'), 0, 0, 2, 0, ...Buffer.from('isomiso2')]);
const probe = JSON.stringify({ format: { duration: '2', format_name: 'mov' }, streams: [{ codec_type: 'video', width: 64, height: 32, codec_name: 'h264' }] });
const jpeg = Buffer.from([255, 216, 255, 217]);
const binaries = async () => ({ nice: '/usr/bin/nice', ffmpeg: '/host/ffmpeg', ffprobe: '/host/ffprobe' });
// The injected runner writes only bounded test bytes; no codec executable is invoked.
function outputs(args: readonly string[]) { return args.filter((arg, index) => args[index - 1] !== '-i' && /[/](?:image|tile)-\d+\.jpg$/.test(arg)); }
async function emitImages(args: readonly string[], images: readonly Uint8Array[]) {
  const paths = outputs(args);
  for (let i = 0; i < paths.length; i++) await writeFile(paths[i]!, images[Math.min(i, images.length - 1)]!);
  return new Uint8Array();
}
function values(args: readonly string[], flag: string) { return args.flatMap((arg, i) => arg === flag ? [args[i + 1]!] : []); }
function child() {
  const result = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: 123, kill: vi.fn(() => true) });
  return result;
}
afterEach(() => vi.useRealTimers());

it('kills the entire subprocess group on the hard timeout', async () => {
  vi.useFakeTimers();
  const process = child();
  const killGroup = vi.fn(() => { process.emit('close', null, 'SIGKILL'); });
  const pending = runLowPriorityVideoProcess({ command: '/usr/bin/nice', args: [], spawnProcess: (() => process as unknown as ChildProcess) as typeof spawn, killGroup }, { timeoutMs: 10, maxOutputBytes: 100 });
  const rejected = expect(pending).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(11);
  await rejected;
  expect(killGroup).toHaveBeenCalledWith({ pid: 123 }, {});
});

it('kills on abort and on bounded-output overflow', async () => {
  for (const overflow of [false, true]) {
    const process = child();
    const killGroup = vi.fn(() => process.emit('close', null, 'SIGKILL'));
    const controller = new AbortController();
    const pending = runLowPriorityVideoProcess({ command: '/usr/bin/nice', args: [], spawnProcess: (() => process as unknown as ChildProcess) as typeof spawn, killGroup }, { timeoutMs: 100, maxOutputBytes: 10, signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow(overflow ? /output limit/ : /canceled/);
    if (overflow) process.stdout.emit('data', Buffer.alloc(11));
    else controller.abort();
    await rejected;
    expect(killGroup).toHaveBeenCalledTimes(1);
  }
});

it('missing binaries returns an explicit unavailable result without spawning', async () => {
  const run = vi.fn();
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: async () => undefined, runProcess: run }, {});
  expect(await extractor.extract({ bytes: mp4 }, {})).toEqual({ ok: false, reason: 'unavailable', message: 'video preview unavailable on this host (nice, ffmpeg and ffprobe are required).' });
  expect(run).not.toHaveBeenCalled();
});

it('seeks each input independently in one niced ffmpeg, limits all threads and cleans private files', async () => {
  const calls: Array<{ command: string; args: readonly string[]; timeout: number }> = [];
  let inputPath = '';
  let outputPaths: string[] = [];
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async (required, optional) => {
    calls.push({ ...required, timeout: optional.timeoutMs });
    inputPath = required.args[required.args.indexOf('-i') + 1]!;
    await access(inputPath);
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    outputPaths = outputs(required.args);
    return emitImages(required.args, [jpeg]);
  } }, {});
  const result = await extractor.extract({ bytes: mp4 }, { frames: 2 });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.frames.map(frame => frame.at)).toEqual([0.1, 1.9]);
  expect(result.frames.map(frame => frame.bytes)).toEqual([jpeg, jpeg]);
  expect(calls).toHaveLength(2); // ffprobe plus ONE ffmpeg.
  for (const call of calls) {
    expect(call.command).toBe('/usr/bin/nice');
    expect(call.args.slice(0, 2)).toEqual(['-n', '19']);
    expect(values(call.args, '-threads').every(value => value === '1')).toBe(true);
    expect(values(call.args, '-protocol_whitelist').every(value => value === 'file')).toBe(true);
    expect(call.timeout).toBeGreaterThan(0);
    expect(call.timeout).toBeLessThanOrEqual(VIDEO_EXTRACTION_TIMEOUT_MS);
  }
  const args = calls[1]!.args;
  expect(values(args, '-ss')).toEqual(['0.1', '1.9']);
  expect(values(args, '-i')).toEqual([inputPath, inputPath]);
  for (let i = 0; i < args.length; i++) if (args[i] === '-ss') expect(args[i + 2]).toBe('-i');
  expect(values(args, '-threads')).toEqual(['1', '1', '1', '1']); // Two decoders and two encoders.
  expect(values(args, '-frames:v')).toEqual(['1', '1']);
  expect(values(args, '-fs')).toEqual(Array(2).fill(String(VIDEO_MAX_FRAME_BYTES)));
  expect(values(args, '-filter_threads')).toEqual(['1']);
  expect(values(args, '-filter_complex_threads')).toEqual(['1']);
  expect(args[args.indexOf('-filter_complex') + 1]).toContain("scale=w='min(768,iw)'");
  await expect(access(inputPath)).rejects.toThrow();
  for (const path of outputPaths) await expect(access(path)).rejects.toThrow();
});

it.each(['frames', 'sheet'] as const)('uses output-scoped passthrough without removed vsync across all batches (%s)', async layout => {
  const calls: Array<readonly string[]> = [];
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async required => {
    calls.push(required.args);
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    return emitImages(required.args, [jpeg]);
  } }, {});
  // Seventeen frames exercise multiple outputs, multiple batches and a one-tile final sheet.
  const result = await extractor.extract({ bytes: mp4 }, { frames: 17, layout });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(layout === 'sheet' ? result.sheets!.length : result.frames.length).toBe(layout === 'sheet' ? 2 : 17);
  for (const args of calls) expect(args).not.toContain('-vsync');
  const [probeArgs, ...ffmpegCalls] = calls;
  expect(probeArgs![2]).toBe('/host/ffprobe');
  expect(probeArgs!).not.toContain('-fps_mode');
  expect(ffmpegCalls.map(args => outputs(args).length)).toEqual(layout === 'sheet' ? [8, 8, 1, 1, 1] : [8, 8, 1]);
  for (const args of ffmpegCalls) {
    expect(args[2]).toBe('/host/ffmpeg');
    const paths = outputs(args);
    expect(values(args, '-fps_mode')).toEqual(paths.map(() => 'passthrough'));
    let start = args.lastIndexOf('-i') + 2;
    expect(args.slice(0, start)).not.toContain('-fps_mode');
    // ffmpeg resets output options at each path; a single shared flag cannot cover all outputs.
    for (const path of paths) {
      const end = args.indexOf(path);
      expect(values(args.slice(start, end), '-fps_mode')).toEqual(['passthrough']);
      start = end + 1;
    }
  }
});

it('forwards gap and start through eight serial batches with whole-request file shares', async () => {
  const calls: Array<readonly string[]> = [];
  const longProbe = Buffer.from(probe.replace('"duration":"2"', '"duration":"20"'));
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async required => {
    if (required.args[2] === '/host/ffprobe') return longProbe;
    expect(required.command).toBe('/usr/bin/nice');
    expect(required.args.slice(0, 2)).toEqual(['-n', '19']);
    calls.push(required.args);
    return emitImages(required.args, [jpeg]);
  } }, {});
  const result = await extractor.extract({ bytes: mp4 }, { every: 0.1, start: 0.2 });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.frames).toHaveLength(64);
  expect(result.frames[0]!.at).toBe(0.2);
  expect(result.frames[63]!.at).toBeCloseTo(6.5);
  expect(calls).toHaveLength(8);
  expect(calls.flatMap(args => values(args, '-ss'))).toEqual(result.frames.map(frame => String(frame.at)));
  for (const args of calls) {
    expect(values(args, '-i')).toHaveLength(8);
    expect(values(args, '-threads')).toEqual(Array(16).fill('1'));
    expect(values(args, '-fs')).toEqual(Array(8).fill(String(VIDEO_MAX_OUTPUT_BYTES / 64)));
    expect(args[args.indexOf('-filter_complex') + 1]).toContain("scale=w='min(384,iw)'");
  }
});

it('accepts exactly the aggregate JPEG budget and refuses file overflow without partial frames', async () => {
  expect(VIDEO_MAX_OUTPUT_BYTES).toBe(8 * 1024 * 1024);
  const image = Buffer.alloc(VIDEO_MAX_FRAME_BYTES);
  image.set([255, 216], 0);
  image.set([255, 217], image.length - 2);
  let inputPath = '';
  let emitted = image;
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async required => {
    inputPath = required.args[required.args.indexOf('-i') + 1]!;
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    return emitImages(required.args, [emitted]);
  } }, {});
  const exact = await extractor.extract({ bytes: mp4 }, { frames: 16 });
  expect(exact.ok).toBe(true);
  if (!exact.ok) throw new Error(exact.message);
  expect(exact.frames.reduce((sum, frame) => sum + frame.bytes.byteLength, 0)).toBe(VIDEO_MAX_OUTPUT_BYTES);
  emitted = Buffer.alloc(VIDEO_MAX_FRAME_BYTES + 1);
  expect(await extractor.extract({ bytes: mp4 }, { frames: 16 })).toEqual({ ok: false, reason: 'invalid', message: 'Video preview exceeded its output limit.' });
  await expect(access(inputPath)).rejects.toThrow();
});

it('allocates an aggregate-safe per-image file budget and refuses a runner that ignores it', async () => {
  const image = Buffer.alloc(Math.floor(VIDEO_MAX_OUTPUT_BYTES / 64) + 1);
  image.set([255, 216], 0);
  image.set([255, 217], image.length - 2);
  let args: readonly string[] = [];
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async required => {
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    args = required.args;
    return emitImages(args, [image]);
  } }, {});
  expect(await extractor.extract({ bytes: mp4 }, { frames: 64 })).toEqual({ ok: false, reason: 'invalid', message: 'Video preview exceeded its total output limit (8 MiB).' });
  const allocations = values(args, '-fs').map(Number);
  expect(allocations).toEqual(Array(8).fill(VIDEO_MAX_OUTPUT_BYTES / 64)); // Stop after first oversized batch.
  // Failure must release the process-wide lock.
  const absent = createFfmpegVideoFrameExtractor({ findBinaries: async () => undefined }, {});
  expect(await absent.extract({ bytes: mp4 }, {})).toMatchObject({ reason: 'unavailable' });
});

it('keeps the per-frame budget even when an injected process runner ignores its file limit', async () => {
  const image = Buffer.alloc(VIDEO_MAX_FRAME_BYTES + 1);
  image.set([255, 216], 0);
  image.set([255, 217], image.length - 2);
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async required => required.args[2] === '/host/ffprobe' ? Buffer.from(probe) : emitImages(required.args, [image]) }, {});
  expect(await extractor.extract({ bytes: mp4 }, { frames: 1 })).toEqual({ ok: false, reason: 'invalid', message: 'Video preview exceeded its output limit.' });
});

it('allows only one extraction across separate adapter instances; releases after failure', async () => {
  let enter!: () => void;
  let finish!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const first = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async () => { enter(); await waiting; throw new Error('bad clip'); } }, {});
  const pending = first.extract({ bytes: mp4 }, {});
  await entered;
  const second = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async () => Buffer.from(probe) }, {});
  expect(await second.extract({ bytes: mp4 }, {})).toMatchObject({ ok: false, reason: 'busy' });
  finish();
  expect(await pending).toMatchObject({ ok: false, reason: 'invalid' });
  const absent = createFfmpegVideoFrameExtractor({ findBinaries: async () => undefined }, {});
  expect(await absent.extract({ bytes: mp4 }, {})).toMatchObject({ reason: 'unavailable' });
});

it('refuses oversize and non-video input before any process runs', async () => {
  const run = vi.fn();
  const extractor = createFfmpegVideoFrameExtractor({ runProcess: run }, {});
  expect(await extractor.extract({ bytes: new Uint8Array(VIDEO_MAX_INPUT_BYTES + 1) }, {})).toMatchObject({ ok: false, reason: 'too-large' });
  expect(await extractor.extract({ bytes: Buffer.from('file:///etc/passwd') }, {})).toMatchObject({ ok: false, reason: 'invalid' });
  expect(run).not.toHaveBeenCalled();
});

it('the real kill implementation targets the detached process group, not only nice', async () => {
  vi.useFakeTimers();
  const childProcess = child();
  const killed = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    expect(pid).toBe(-123);
    expect(signal).toBe('SIGKILL');
    childProcess.emit('close', null, 'SIGKILL');
    return true;
  });
  try {
    const pending = runLowPriorityVideoProcess({ command: '/usr/bin/nice', args: [], spawnProcess: (() => childProcess as unknown as ChildProcess) as typeof spawn }, { timeoutMs: 10, maxOutputBytes: 100 });
    const rejected = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(11);
    await rejected;
    expect(killed).toHaveBeenCalledTimes(1);
  } finally { killed.mockRestore(); }
});

it('ENOENT is reported unavailable and cannot leave a codec process running', async () => {
  const childProcess = child();
  const pending = runLowPriorityVideoProcess({ command: '/missing/nice', args: [], spawnProcess: (() => childProcess as unknown as ChildProcess) as typeof spawn }, { timeoutMs: 100, maxOutputBytes: 100 });
  const rejected = expect(pending).rejects.toThrow(/could not start/);
  childProcess.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
  await rejected;
});

it('shares one deadline across probe and all eight batches', async () => {
  let elapsed = 0;
  const budgets: number[] = [];
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, nowMs: () => elapsed, runProcess: async (required, optional) => {
    budgets.push(optional.timeoutMs);
    elapsed += 2000;
    return required.args[2] === '/host/ffprobe' ? Buffer.from(probe) : emitImages(required.args, [jpeg]);
  } }, {});
  expect(VIDEO_EXTRACTION_TIMEOUT_MS).toBe(60_000);
  expect(await extractor.extract({ bytes: mp4 }, { frames: 64 })).toMatchObject({ ok: true });
  expect(budgets).toEqual([60_000, 58_000, 56_000, 54_000, 52_000, 50_000, 48_000, 46_000, 44_000]);
});

it('does not launch another seek when the extraction deadline has expired', async () => {
  let elapsed = 0;
  const run = vi.fn(async () => { elapsed = VIDEO_EXTRACTION_TIMEOUT_MS + 1; return Buffer.from(probe); });
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, nowMs: () => elapsed, runProcess: run }, {});
  expect(await extractor.extract({ bytes: mp4 }, {})).toMatchObject({ ok: false, reason: 'timeout' });
  expect(run).toHaveBeenCalledTimes(1);
});


it('builds four sheets from eight source batches and four JPEG-only assembly passes', async () => {
  const calls: Array<readonly string[]> = [];
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async required => {
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    calls.push(required.args);
    return emitImages(required.args, [jpeg]);
  } }, {});
  const result = await extractor.extract({ bytes: mp4 }, { frames: 64, layout: 'sheet' });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.frames).toEqual([]);
  expect(result.sheets).toHaveLength(4);
  expect(calls).toHaveLength(12);
  const extraction = calls.slice(0, 8);
  const assembly = calls.slice(8);
  expect(result.sheets!.flatMap(sheet => sheet.tiles).map(tile => tile.at)).toEqual(extraction.flatMap(args => values(args, '-ss').map(Number)));
  expect(result.sheets!.map(sheet => [sheet.columns, sheet.rows, sheet.tileEdgePx])).toEqual(Array(4).fill([4, 4, 384]));
  for (const args of extraction) {
    expect(values(args, '-i')).toHaveLength(8);
    expect(values(args, '-i').every(path => path.endsWith('/input'))).toBe(true);
    expect(values(args, '-fs')).toEqual(Array(8).fill(String(VIDEO_MAX_OUTPUT_BYTES / 64)));
    expect(values(args, '-threads')).toEqual(Array(16).fill('1'));
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('pad=384:384');
  }
  for (const [index, args] of assembly.entries()) {
    expect(values(args, '-i').map(path => path.split('/').pop())).toEqual(Array.from({ length: 16 }, (_, tile) => `tile-${index * 16 + tile}.jpg`));
    expect(values(args, '-f')).toEqual(Array(17).fill('mjpeg'));
    expect(values(args, '-threads')).toEqual(Array(17).fill('1'));
    expect(values(args, '-fs')).toEqual([String(VIDEO_MAX_SHEET_BYTES)]);
    const filters = args[args.indexOf('-filter_complex') + 1]!;
    expect(filters).toContain('xstack=inputs=16');
    expect(filters).toContain('layout=0_0|384_0|768_0|1152_0|0_384');
    expect(filters).not.toContain('drawtext');
  }
  for (const args of calls) {
    expect(args.slice(0, 3)).toEqual(['-n', '19', '/host/ffmpeg']);
    expect(values(args, '-protocol_whitelist').every(value => value === 'file')).toBe(true);
    expect(values(args, '-filter_threads')).toEqual(['1']);
    expect(values(args, '-filter_complex_threads')).toEqual(['1']);
  }
});

it('handles one-tile sheets and rejects missing, invalid or oversized sheet JPEGs', async () => {
  let args: readonly string[] = [];
  let image: Uint8Array | undefined = jpeg;
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async required => {
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    args = required.args;
    if (values(args, '-ss').length) return emitImages(args, [jpeg]); // Validate final sheet failures independently of tile extraction.
    return image ? emitImages(args, [image]) : new Uint8Array();
  } }, {});
  const result = await extractor.extract({ bytes: mp4 }, { at: [1], layout: 'sheet' });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.sheets![0]!.tiles).toEqual([{ index: 1, row: 1, column: 1, at: 1 }]);
  expect(args[args.indexOf('-filter_complex') + 1]).not.toContain('xstack');
  image = Buffer.alloc(VIDEO_MAX_SHEET_BYTES + 1);
  expect(await extractor.extract({ bytes: mp4 }, { at: [1], layout: 'sheet' })).toMatchObject({ ok: false, reason: 'invalid', message: 'Video preview exceeded its output limit.' });
  image = Buffer.from([1, 2, 3, 4]);
  expect(await extractor.extract({ bytes: mp4 }, { at: [1], layout: 'sheet' })).toMatchObject({ ok: false, reason: 'invalid', message: 'Video preview returned no JPEG frame.' });
  image = undefined;
  expect(await extractor.extract({ bytes: mp4 }, { at: [1], layout: 'sheet' })).toMatchObject({ ok: false, reason: 'invalid' });
});


it('omitted count defaults to sixteen separate 768px frames in two serial batches', async () => {
  let calls = 0;
  let args: readonly string[] = [];
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async required => {
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    calls++;
    args = required.args;
    return emitImages(args, [jpeg]);
  } }, {});
  const result = await extractor.extract({ bytes: mp4 }, {});
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.frames).toHaveLength(16);
  expect(result.sheets).toBeUndefined();
  expect(calls).toBe(2);
  expect(values(args, '-i')).toHaveLength(8);
  expect(values(args, '-fs')).toEqual(Array(8).fill(String(VIDEO_MAX_FRAME_BYTES)));
  expect(values(args, '-f')).toEqual(Array(8).fill('mjpeg'));
  expect(args[args.indexOf('-filter_complex') + 1]).toContain("scale=w='min(768,iw)'");
});

it('partial sheets retain repeated and unsorted sampling positions with a black unused cell', async () => {
  let args: readonly string[] = [];
  const seeks: string[] = [];
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async required => {
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    args = required.args;
    seeks.push(...values(args, '-ss'));
    return emitImages(args, [jpeg]);
  } }, {});
  const result = await extractor.extract({ bytes: mp4 }, { at: [1, 0, 1], layout: 'sheet' });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(seeks).toEqual(['1', '0', '1']);
  expect(result.sheets![0]!.tiles.map(tile => tile.at)).toEqual([1, 0, 1]);
  expect(result.sheets![0]).toMatchObject({ columns: 2, rows: 2, tileEdgePx: 768 });
  expect(args[args.indexOf('-filter_complex') + 1]).toContain('xstack=inputs=3:layout=0_0|768_0|0_768:fill=black:shortest=1');
  expect(args[args.indexOf('-filter_complex') + 1]).toContain('pad=1536:1536:0:0:color=black');
});

it('refuses invalid layout before discovery and rejects an expired deadline after ffmpeg returns', async () => {
  const find = vi.fn(binaries);
  const invalid = createFfmpegVideoFrameExtractor({ findBinaries: find }, {});
  expect(await invalid.extract({ bytes: mp4 }, { layout: 'grid' as 'sheet' })).toEqual({ ok: false, reason: 'invalid', message: 'Video layout must be frames or sheet.' });
  expect(find).not.toHaveBeenCalled();
  let elapsed = 0;
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, nowMs: () => elapsed, runProcess: async required => {
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    await emitImages(required.args, [jpeg]);
    elapsed = VIDEO_EXTRACTION_TIMEOUT_MS + 1;
    return new Uint8Array();
  } }, {});
  expect(await extractor.extract({ bytes: mp4 }, { frames: 1 })).toEqual({ ok: false, reason: 'timeout', message: 'Video preview timed out.' });
});


it.each([16, 64])('preserves unsorted duplicate timestamps and JPEG order over serial batches (%i frames)', async count => {
  const times = Array.from({ length: count }, (_, i) => [1, 0.2, 1.8, 0.2][i % 4]!);
  const images = Array.from({ length: count }, (_, i) => Buffer.from([255, 216, i, 255, 217]));
  let completed = 0;
  let active = 0;
  const calls: Array<readonly string[]> = [];
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async required => {
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    expect(active).toBe(0);
    active++;
    calls.push(required.args);
    const batchSize = values(required.args, '-i').length;
    expect(batchSize).toBe(8);
    await emitImages(required.args, images.slice(completed, completed + batchSize));
    completed += batchSize;
    active--;
    return new Uint8Array();
  } }, {});
  const result = await extractor.extract({ bytes: mp4 }, { at: times });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(calls).toHaveLength(count / 8);
  expect(calls.flatMap(args => values(args, '-ss').map(Number))).toEqual(times);
  expect(result.frames.map(frame => frame.at)).toEqual(times);
  expect(result.frames.map(frame => frame.bytes)).toEqual(images);
  expect(calls.flatMap(args => values(args, '-fs'))).toEqual(Array(count).fill(String(Math.min(VIDEO_MAX_FRAME_BYTES, VIDEO_MAX_OUTPUT_BYTES / count))));
});

it.each([16, 64])('sheet source invocations stay capped and use one shared deadline (%i frames)', async count => {
  const times = Array.from({ length: count }, (_, i) => [1, 0.2, 1.8, 0.2][i % 4]!);
  const seeks: number[] = [];
  let elapsed = 0;
  const budgets: number[] = [];
  let sourcePath = '';
  let sourceCalls = 0;
  let assemblyCalls = 0;
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, nowMs: () => elapsed, runProcess: async (required, optional) => {
    budgets.push(optional.timeoutMs);
    elapsed += 1000;
    if (required.args[2] === '/host/ffprobe') {
      sourcePath = values(required.args, '-i')[0]!;
      return Buffer.from(probe);
    }
    const inputs = values(required.args, '-i');
    const sourceInputs = inputs.filter(path => path === sourcePath);
    expect(sourceInputs.length).toBeLessThanOrEqual(8);
    if (sourceInputs.length) {
      sourceCalls++;
      seeks.push(...values(required.args, '-ss').map(Number));
      expect(sourceInputs).toHaveLength(8);
    } else {
      assemblyCalls++;
      expect(sourceCalls).toBe(count / 8);
      expect(inputs).toHaveLength(16);
      for (const input of inputs) await access(input);
    }
    return emitImages(required.args, [jpeg]);
  } }, {});
  const result = await extractor.extract({ bytes: mp4 }, { at: times, layout: 'sheet' });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(seeks).toEqual(times);
  expect(result.sheets!.flatMap(sheet => sheet.tiles).map(tile => tile.at)).toEqual(times);
  expect(sourceCalls).toBe(count / 8);
  expect(assemblyCalls).toBe(count / 16);
  expect(budgets).toEqual(Array.from({ length: 1 + count / 8 + count / 16 }, (_, i) => VIDEO_EXTRACTION_TIMEOUT_MS - 1000 * i));
});

it.each(['frames', 'sheet'] as const)('stops after the first batch when the shared deadline expires (%s)', async layout => {
  let elapsed = 0;
  const paths: string[] = [];
  let calls = 0;
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, nowMs: () => elapsed, runProcess: async required => {
    paths.push(...values(required.args, '-i'), ...outputs(required.args));
    calls++;
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    await emitImages(required.args, [jpeg]);
    elapsed = VIDEO_EXTRACTION_TIMEOUT_MS;
    return new Uint8Array();
  } }, {});
  expect(await extractor.extract({ bytes: mp4 }, { frames: 64, layout })).toEqual({ ok: false, reason: 'timeout', message: 'Video preview timed out.' });
  expect(calls).toBe(2);
  for (const path of paths) await expect(access(path)).rejects.toThrow();
});

it.each(['frames', 'sheet'] as const)('cancellation in batch two kills the group, waits for close and removes all private files (%s)', async layout => {
  const controller = new AbortController();
  const codec = child();
  const killGroup = vi.fn(); // Deliberately delay close: the lock must remain held until exit.
  let entered!: () => void;
  const secondBatch = new Promise<void>(resolve => { entered = resolve; });
  const paths: string[] = [];
  let directory = '';
  let codecCalls = 0;
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async (required, optional) => {
    paths.push(...values(required.args, '-i'), ...outputs(required.args));
    directory = values(required.args, '-i')[0]!.replace(/[/]input$/, '');
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    codecCalls++;
    await emitImages(required.args, [jpeg]); // Include files from the interrupted batch.
    if (codecCalls === 1) return new Uint8Array();
    const pending = runLowPriorityVideoProcess({ ...required, spawnProcess: (() => codec as unknown as ChildProcess) as typeof spawn, killGroup }, optional);
    entered();
    return pending;
  } }, {});
  const pending = extractor.extract({ bytes: mp4 }, { frames: 64, layout, signal: controller.signal });
  await secondBatch;
  expect((await readdir(directory)).length).toBe(17); // Input plus two eight-image batches.
  controller.abort();
  expect(killGroup).toHaveBeenCalledTimes(1);
  expect(killGroup).toHaveBeenCalledWith({ pid: 123 }, {});
  const other = createFfmpegVideoFrameExtractor({ findBinaries: async () => undefined }, {});
  expect(await other.extract({ bytes: mp4 }, {})).toMatchObject({ reason: 'busy' });
  await access(directory);
  codec.emit('close', null, 'SIGKILL');
  expect(await pending).toEqual({ ok: false, reason: 'canceled', message: 'Video preview canceled.' });
  expect(codecCalls).toBe(2);
  for (const path of paths) await expect(access(path)).rejects.toThrow();
  await expect(access(directory)).rejects.toThrow();
  expect(await other.extract({ bytes: mp4 }, {})).toMatchObject({ reason: 'unavailable' });
});

it('validates sheet output after bounded tile extraction, removes used tiles before the next sheet', async () => {
  let assemblies = 0;
  let directory = '';
  let invalidFinal = false;
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async required => {
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    const inputs = values(required.args, '-i');
    directory = inputs[0]!.replace(/[/](?:input|tile-\d+\.jpg)$/, '');
    if (inputs[0]!.endsWith('/input')) return emitImages(required.args, [jpeg]);
    if (assemblies++ === 1) {
      for (let i = 0; i < 16; i++) await expect(access(`${directory}/tile-${i}.jpg`)).rejects.toThrow();
    }
    return emitImages(required.args, [invalidFinal ? Buffer.from([1, 2, 3, 4]) : jpeg]);
  } }, {});
  expect(await extractor.extract({ bytes: mp4 }, { frames: 32, layout: 'sheet' })).toMatchObject({ ok: true });
  expect(assemblies).toBe(2);
  await expect(access(directory)).rejects.toThrow();
  invalidFinal = true;
  expect(await extractor.extract({ bytes: mp4 }, { frames: 16, layout: 'sheet' })).toEqual({ ok: false, reason: 'invalid', message: 'Video preview returned no JPEG frame.' });
  await expect(access(directory)).rejects.toThrow();
});


it('keeps the full 8 MiB sheet budget across separate JPEG assembly passes', async () => {
  const image = Buffer.alloc(VIDEO_MAX_SHEET_BYTES);
  image.set([255, 216], 0);
  image.set([255, 217], image.length - 2);
  const limits: number[] = [];
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async required => {
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    if (values(required.args, '-ss').length) return emitImages(required.args, [jpeg]);
    limits.push(...values(required.args, '-fs').map(Number));
    return emitImages(required.args, [image]);
  } }, {});
  const result = await extractor.extract({ bytes: mp4 }, { frames: 64, layout: 'sheet' });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(limits).toEqual(Array(4).fill(VIDEO_MAX_SHEET_BYTES));
  expect(result.sheets!.reduce((sum, sheet) => sum + sheet.bytes.byteLength, 0)).toBe(VIDEO_MAX_OUTPUT_BYTES);
});

it('observes cancellation after a runner returns, before starting any later batch', async () => {
  const controller = new AbortController();
  let calls = 0;
  let inputPath = '';
  const extractor = createFfmpegVideoFrameExtractor({ findBinaries: binaries, runProcess: async required => {
    inputPath = values(required.args, '-i')[0]!;
    calls++;
    if (required.args[2] === '/host/ffprobe') return Buffer.from(probe);
    await emitImages(required.args, [jpeg]);
    controller.abort(); // Even an injected runner that ignores its signal cannot launch batch two.
    return new Uint8Array();
  } }, {});
  expect(await extractor.extract({ bytes: mp4 }, { frames: 64, signal: controller.signal })).toEqual({ ok: false, reason: 'canceled', message: 'Video preview canceled.' });
  expect(calls).toBe(2);
  await expect(access(inputPath)).rejects.toThrow();
});
