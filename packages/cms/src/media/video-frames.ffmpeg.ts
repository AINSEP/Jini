import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { delimiter, isAbsolute, join } from 'node:path';
import { sniffContentType } from './content-type-sniffer.js';
import { getVideoFrameEdge, parseVideoProbe, planVideoFrames, planVideoContactSheets, VIDEO_EXTRACTION_TIMEOUT_MS, VIDEO_MAX_SHEET_BYTES, VIDEO_MAX_FRAME_BYTES, VIDEO_MAX_INPUT_BYTES, VIDEO_MAX_OUTPUT_BYTES, type VideoFrameExtractor, type VideoFrameResult } from './video-frames.js';

export interface VideoBinaries { readonly nice: string; readonly ffmpeg: string; readonly ffprobe: string }
export type VideoBinaryFinder = (required: Record<string, never>, optional: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform }) => Promise<VideoBinaries | undefined>;
export type VideoProcessRunner = (required: { command: string; args: readonly string[] }, optional: { timeoutMs: number; maxOutputBytes: number; signal?: AbortSignal }) => Promise<Uint8Array>;
class VideoProcessError extends Error {
  constructor(readonly reason: 'unavailable' | 'timeout' | 'canceled' | 'invalid', message: string) { super(message); }
}

async function executable(required: { name: string }, { configured, env }: { configured?: string | undefined; env: NodeJS.ProcessEnv }): Promise<string | undefined> {
  const candidates = configured ? [configured] : [
    ...(env['PATH'] ?? '').split(delimiter).filter(isAbsolute).map(directory => join(directory, required.name)),
    join('/opt/homebrew/bin', required.name), join('/usr/local/bin', required.name), join('/usr/bin', required.name),
  ];
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) continue;
    try { await access(candidate, constants.X_OK); if ((await stat(candidate)).isFile()) return candidate; } catch { /* Try the next host executable. */ }
  }
  return undefined;
}

/** Discovery never executes a version/probe command. Configured paths are host configuration,
 * never tool arguments, and all subprocesses (including ffprobe) still go through nice. */
export const findVideoBinaries: VideoBinaryFinder = async (_required, { env = process.env, platform = process.platform } = {}) => {
  if (platform === 'win32') return undefined; // Never silently omit the low-priority guarantee.
  const nice = await executable({ name: 'nice' }, { env });
  const ffmpeg = await executable({ name: 'ffmpeg' }, { configured: env['FFMPEG_PATH'], env });
  const ffprobe = await executable({ name: 'ffprobe' }, { configured: env['FFPROBE_PATH'], env });
  return nice && ffmpeg && ffprobe ? { nice, ffmpeg, ffprobe } : undefined;
};

/** detached creates a group including nice and its eventual executable; killing the group prevents
 * a wrapper from leaving a decoder alive. Waiting for close keeps the extraction lock until exit. */
export const runLowPriorityVideoProcess = async (
  { command, args, spawnProcess = spawn, killGroup = ({ pid }: { pid: number }) => { process.kill(-pid, 'SIGKILL'); } }: {
    command: string; args: readonly string[]; spawnProcess?: typeof spawn;
    killGroup?: (required: { pid: number }, optional: Record<string, never>) => void;
  },
  { timeoutMs, maxOutputBytes, signal }: { timeoutMs: number; maxOutputBytes: number; signal?: AbortSignal },
): Promise<Uint8Array> => {
  if (signal?.aborted) throw new VideoProcessError('canceled', 'Video preview canceled.');
  if (timeoutMs <= 0) throw new VideoProcessError('timeout', 'Video preview timed out.');
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, [...args], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stopped: VideoProcessError | undefined;
    let settled = false;
    const stop = (error: VideoProcessError) => {
      if (stopped || settled) return;
      stopped = error;
      try { if (child.pid === undefined) child.kill('SIGKILL'); else killGroup({ pid: child.pid }, {}); }
      catch { child.kill('SIGKILL'); }
    };
    const timer = setTimeout(() => stop(new VideoProcessError('timeout', 'Video preview timed out.')), timeoutMs);
    const abort = () => stop(new VideoProcessError('canceled', 'Video preview canceled.'));
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(Buffer.concat(chunks));
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stopped) return;
      bytes += chunk.length;
      if (bytes > maxOutputBytes) { stop(new VideoProcessError('invalid', 'Video preview exceeded its output limit.')); return; }
      chunks.push(chunk);
    });
    // Drain diagnostics but do not retain unbounded stderr or expose host paths to the model.
    child.stderr?.resume();
    child.once('error', (error: NodeJS.ErrnoException) => finish(new VideoProcessError(error.code === 'ENOENT' || error.code === 'EACCES' ? 'unavailable' : 'invalid', 'Video preview process could not start.')));
    child.once('close', (code: number | null) => finish(stopped ?? (code === 0 ? undefined : new VideoProcessError('invalid', 'Video preview could not decode this clip.'))));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
};

export interface VideoExtractionLock {
  /** Synchronous acquisition prevents races before the first awaited probe. */
  tryAcquire(required: Record<string, never>, optional: Record<string, never>): (() => void) | undefined;
}
/** A host may share this lock across its adapters to enforce a decoder budget.
 * Returns a synchronous try-acquire port; release follows decoder cleanup. @complexity O(1). */
export function createVideoExtractionLock(_required: Record<string, never>, _optional: Record<string, never> = {}): VideoExtractionLock {
  let extracting = false;
  return { tryAcquire() {
    if (extracting) return undefined;
    extracting = true;
    let released = false;
    return () => { if (!released) { released = true; extracting = false; } };
  } };
}
// Shared across ALL adapter instances: a second catalog/tenant cannot run a second ffmpeg in this
// process. Fail busy instead of holding arbitrary numbers of uploaded videos in a pending queue.
const defaultExtractionLock = createVideoExtractionLock({});
const UNAVAILABLE = 'video preview unavailable on this host (nice, ffmpeg and ffprobe are required).';
// Eight amortizes process/seek overhead while bounding expensive source decoders to
// one eighth of the 64-frame maximum. Thread caps alone do not bound decoder memory.
// This is a decoder-count limit, not a measured host RSS guarantee.
const SOURCE_BATCH_SIZE = 8;
const localInputFlags = ['-threads', '1', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm'];

type VideoFrameFailure = Extract<VideoFrameResult, { ok: false }>;
type ContactSheetLayout = ReturnType<typeof planVideoContactSheets>[number];
const TOTAL_OUTPUT_LIMIT = 'Video preview exceeded its total output limit (8 MiB).';
const DIAGNOSTIC_OUTPUT_BYTES = 64 * 1024;

/** Size and container checks that need neither the lock nor a host binary. */
function rejectVideoInput({ bytes }: { bytes: Uint8Array }): VideoFrameFailure | undefined {
  if (bytes.byteLength > VIDEO_MAX_INPUT_BYTES) return { ok: false, reason: 'too-large', message: `Video preview input exceeds ${VIDEO_MAX_INPUT_BYTES} bytes.` };
  const type = sniffContentType({ bytes });
  if (type !== 'video/mp4' && type !== 'video/webm') return { ok: false, reason: 'invalid', message: 'Video preview requires stored MP4 or WebM bytes.' };
  return undefined;
}

function toVideoFailure(error: unknown): VideoFrameFailure {
  if (!(error instanceof VideoProcessError)) return { ok: false, reason: 'invalid', message: 'Video preview could not read or decode this clip.' };
  return { ok: false, reason: error.reason, message: error.reason === 'unavailable' ? UNAVAILABLE : error.message };
}

interface ExtractionRun {
  readonly checkDeadline: () => void;
  readonly run: (required: { binary: string; args: readonly string[] }, optional: { maxOutputBytes: number }) => Promise<Uint8Array>;
}
/** One deadline shared by the probe and every ffmpeg pass; each process gets only what is left. */
function createExtractionRun(
  { binaries, runProcess, nowMs, deadline }: { binaries: VideoBinaries; runProcess: VideoProcessRunner; nowMs: () => number; deadline: number },
  { signal }: { signal?: AbortSignal | undefined },
): ExtractionRun {
  const checkDeadline = () => {
    if (signal?.aborted) throw new VideoProcessError('canceled', 'Video preview canceled.');
    if (nowMs() >= deadline) throw new VideoProcessError('timeout', 'Video preview timed out.');
  };
  const run: ExtractionRun['run'] = (required, optional) => {
    checkDeadline();
    const timeoutMs = deadline - nowMs();
    if (timeoutMs <= 0) throw new VideoProcessError('timeout', 'Video preview timed out.');
    return runProcess({ command: binaries.nice, args: ['-n', '19', required.binary, ...required.args] },
      { timeoutMs, maxOutputBytes: optional.maxOutputBytes, ...(signal ? { signal } : {}) });
  };
  return { checkDeadline, run };
}

interface OutputPlan {
  readonly sheetLayouts: readonly ContactSheetLayout[] | undefined;
  readonly edge: number;
  readonly perImageLimit: number;
  readonly fileLimit: number;
  readonly paths: readonly string[];
  readonly tilePaths: readonly string[];
  readonly tileLimit: number;
}
const imagePaths = ({ directory, count, prefix }: { directory: string; count: number; prefix: string }) =>
  Array.from({ length: count }, (_, index) => join(directory, `${prefix}-${index}.jpg`));

function planFrameOutputs({ directory, times }: { directory: string; times: readonly number[] }): OutputPlan {
  // Preallocate a fair share for each output, so all file limits together fit the total budget.
  const fileLimit = Math.min(VIDEO_MAX_FRAME_BYTES, Math.floor(VIDEO_MAX_OUTPUT_BYTES / times.length));
  const paths = imagePaths({ directory, count: times.length, prefix: 'image' });
  return { sheetLayouts: undefined, edge: getVideoFrameEdge({ frameCount: times.length }, {}), perImageLimit: VIDEO_MAX_FRAME_BYTES, fileLimit, paths, tilePaths: paths, tileLimit: fileLimit };
}

function planSheetOutputs({ directory, times }: { directory: string; times: readonly number[] }): OutputPlan {
  const sheetLayouts = planVideoContactSheets({ times }, {});
  return {
    sheetLayouts,
    // planVideoContactSheets throws on no timestamps, so there is always a first sheet.
    edge: sheetLayouts[0]!.tileEdgePx,
    perImageLimit: VIDEO_MAX_SHEET_BYTES,
    fileLimit: Math.min(VIDEO_MAX_SHEET_BYTES, Math.floor(VIDEO_MAX_OUTPUT_BYTES / sheetLayouts.length)),
    paths: imagePaths({ directory, count: sheetLayouts.length, prefix: 'image' }),
    tilePaths: imagePaths({ directory, count: times.length, prefix: 'tile' }),
    // Intermediates have their own bounded allocation; never spend a sheet's 2 MiB per tile.
    tileLimit: Math.min(VIDEO_MAX_FRAME_BYTES, Math.floor(VIDEO_MAX_OUTPUT_BYTES / times.length)),
  };
}

const ffmpegArgs = () => ['-hide_banner', '-loglevel', 'error', '-nostdin', '-filter_threads', '1', '-filter_complex_threads', '1'];
// Framerate mode is per output (ffmpeg >=5.1); preserve each selected frame
// for both source extraction and contact-sheet assembly without resync.
const appendOutput = ({ args, label, path, limit }: { args: string[]; label: string; path: string; limit: number }) => args.push(
  '-map', label, '-an', '-sn', '-dn', '-frames:v', '1', '-c:v', 'mjpeg', '-threads', '1',
  '-q:v', '5', '-fs', String(limit), '-f', 'mjpeg', '-fps_mode', 'passthrough', path,
);
const isJpeg = (image: Uint8Array) => image.length >= 4 && image[0] === 255 && image[1] === 216 && image[image.length - 2] === 255 && image[image.length - 1] === 217;

async function readImage({ path, perImageLimit, fileLimit }: { path: string; perImageLimit: number; fileLimit: number }, { checkDeadline }: Pick<ExtractionRun, 'checkDeadline'>): Promise<Uint8Array> {
  checkDeadline();
  // -fs is packet-granular: check size before allocating and refuse overshoot.
  const size = (await stat(path)).size;
  checkDeadline();
  if (size > perImageLimit) throw new VideoProcessError('invalid', 'Video preview exceeded its output limit.');
  if (size > fileLimit) throw new VideoProcessError('invalid', TOTAL_OUTPUT_LIMIT);
  const image = await readFile(path);
  checkDeadline();
  if (!isJpeg(image)) throw new VideoProcessError('invalid', 'Video preview returned no JPEG frame.');
  return image;
}

function sourceBatchArgs({ batch, offset, input, plan }: { batch: readonly number[]; offset: number; input: string; plan: OutputPlan }): string[] {
  const { edge, sheetLayouts } = plan;
  const scale = `scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease`;
  const pad = sheetLayouts ? `,pad=${edge}:${edge}:(ow-iw)/2:(oh-ih)/2:color=black` : '';
  const args = ffmpegArgs();
  // Seek each source input before opening it; no full-clip select/decode scan.
  for (const at of batch) args.push(...localInputFlags, '-ss', String(at), '-i', input);
  const filters = batch.map((_, index) => `[${index}:V:0]trim=end_frame=1,setpts=PTS-STARTPTS,${scale},setsar=1${pad}[tile${index}]`);
  args.push('-filter_complex', filters.join(';'));
  for (let index = 0; index < batch.length; index++) appendOutput({ args, label: `[tile${index}]`, path: plan.tilePaths[offset + index]!, limit: plan.tileLimit });
  return args;
}

/** Extracts every sampled frame in serial source batches; frames layout keeps them, sheet layout leaves tiles on disk. */
async function extractSourceTiles(
  { input, times, plan, ffmpeg }: { input: string; times: readonly number[]; plan: OutputPlan; ffmpeg: string },
  extraction: ExtractionRun,
): Promise<Uint8Array[]> {
  const images: Uint8Array[] = [];
  let tileBytes = 0;
  // Await exit and validate this batch before starting another: <=8 source contexts alive.
  for (let offset = 0; offset < times.length; offset += SOURCE_BATCH_SIZE) {
    extraction.checkDeadline();
    const batch = times.slice(offset, offset + SOURCE_BATCH_SIZE);
    const args = sourceBatchArgs({ batch, offset, input, plan });
    // Raw MJPEG with one frame writes one JPEG through the file muxer (-fs applies).
    await extraction.run({ binary: ffmpeg, args }, { maxOutputBytes: DIAGNOSTIC_OUTPUT_BYTES });
    extraction.checkDeadline();
    for (let index = 0; index < batch.length; index++) {
      const image = await readImage({ path: plan.tilePaths[offset + index]!, perImageLimit: VIDEO_MAX_FRAME_BYTES, fileLimit: plan.tileLimit }, extraction);
      tileBytes += image.byteLength;
      if (tileBytes > VIDEO_MAX_OUTPUT_BYTES) throw new VideoProcessError('invalid', TOTAL_OUTPUT_LIMIT);
      if (!plan.sheetLayouts) images.push(image); // Sheet tiles remain on disk, not retained in memory.
    }
  }
  return images;
}

function sheetArgs({ inputs, sheet, edge, path, limit }: { inputs: readonly string[]; sheet: ContactSheetLayout; edge: number; path: string; limit: number }): string[] {
  const args = ffmpegArgs();
  // These decoders see only small, validated JPEGs, never the source video.
  for (const input of inputs) args.push('-threads', '1', '-protocol_whitelist', 'file', '-format_whitelist', 'mjpeg', '-f', 'mjpeg', '-i', input);
  const filters = inputs.map((_, tile) => `[${tile}:v:0]trim=end_frame=1,setpts=PTS-STARTPTS[tile${tile}]`);
  const labels = inputs.map((_, tile) => `[tile${tile}]`).join('');
  const positions = sheet.tiles.map(tile => `${(tile.column - 1) * edge}_${(tile.row - 1) * edge}`).join('|');
  const stack = inputs.length === 1 ? 'null' : `xstack=inputs=${inputs.length}:layout=${positions}:fill=black:shortest=1`;
  // Pad the grid if unused bottom-right cells do not establish the full extent.
  filters.push(`${labels}${stack},pad=${sheet.columns * edge}:${sheet.rows * edge}:0:0:color=black[sheet]`);
  args.push('-filter_complex', filters.join(';'));
  appendOutput({ args, label: '[sheet]', path, limit });
  return args;
}

/** Assembles each contact sheet from its validated on-disk tiles, one JPEG-only ffmpeg pass per sheet. */
async function assembleSheets(
  { sheetLayouts, plan, ffmpeg }: { sheetLayouts: readonly ContactSheetLayout[]; plan: OutputPlan; ffmpeg: string },
  extraction: ExtractionRun,
): Promise<Uint8Array[]> {
  const images: Uint8Array[] = [];
  let offset = 0;
  let outputBytes = 0;
  for (const [index, sheet] of sheetLayouts.entries()) {
    extraction.checkDeadline();
    const inputs = plan.tilePaths.slice(offset, offset + sheet.tiles.length);
    const path = plan.paths[index]!;
    await extraction.run({ binary: ffmpeg, args: sheetArgs({ inputs, sheet, edge: plan.edge, path, limit: plan.fileLimit }) }, { maxOutputBytes: DIAGNOSTIC_OUTPUT_BYTES });
    const image = await readImage({ path, perImageLimit: plan.perImageLimit, fileLimit: plan.fileLimit }, extraction);
    outputBytes += image.byteLength;
    if (outputBytes > VIDEO_MAX_OUTPUT_BYTES) throw new VideoProcessError('invalid', TOTAL_OUTPUT_LIMIT);
    images.push(image);
    // Retire tiles as soon as their sheet is verified; finally still cleans on any failure.
    for (const tilePath of inputs) { extraction.checkDeadline(); await rm(tilePath); }
    offset += inputs.length;
  }
  return images;
}

interface ExtractorDeps {
  readonly findBinaries: VideoBinaryFinder;
  readonly runProcess: VideoProcessRunner;
  readonly nowMs: () => number;
  readonly env: NodeJS.ProcessEnv | undefined;
  readonly platform: NodeJS.Platform | undefined;
}
const discoverBinaries = ({ findBinaries, env, platform }: Pick<ExtractorDeps, 'findBinaries' | 'env' | 'platform'>) =>
  findBinaries({}, { ...(env ? { env } : {}), ...(platform ? { platform } : {}) });
/** The locked part of one extraction: discovery, private input, probe, frames and optional sheets.
 * Records the temporary directory in `workspace` as soon as it exists so the caller always removes it. */
async function extractLocked(
  { bytes, options, deadline, workspace }: { bytes: Uint8Array; options: Parameters<VideoFrameExtractor['extract']>[1]; deadline: number; workspace: { directory?: string } },
  { findBinaries, runProcess, nowMs, env, platform }: ExtractorDeps,
): Promise<VideoFrameResult> {
  if (options.signal?.aborted) throw new VideoProcessError('canceled', 'Video preview canceled.');
  if (options.layout !== undefined && options.layout !== 'frames' && options.layout !== 'sheet') throw new VideoProcessError('invalid', 'Video layout must be frames or sheet.');
  const binaries = await discoverBinaries({ findBinaries, env, platform });
  if (!binaries) return { ok: false, reason: 'unavailable', message: UNAVAILABLE };
  const directory = workspace.directory = await mkdtemp(join(tmpdir(), 'video-preview-'));
  const input = join(directory, 'input');
  await writeFile(input, bytes, { mode: 0o600, flag: 'wx' });
  const extraction = createExtractionRun({ binaries, runProcess, nowMs, deadline }, { signal: options.signal });
  const probe = await extraction.run({ binary: binaries.ffprobe, args: ['-v', 'error', ...localInputFlags, '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height,duration:stream_disposition=attached_pic', '-of', 'json', '-i', input] }, { maxOutputBytes: DIAGNOSTIC_OUTPUT_BYTES });
  const metadata = parseVideoProbe({ output: Buffer.from(probe).toString('utf8'), sizeBytes: bytes.byteLength }, {});
  const times = planVideoFrames({ duration: metadata.duration }, options);
  const plan = options.layout === 'sheet' ? planSheetOutputs({ directory, times }) : planFrameOutputs({ directory, times });
  const frames = await extractSourceTiles({ input, times, plan, ffmpeg: binaries.ffmpeg }, extraction);
  const { sheetLayouts } = plan;
  if (!sheetLayouts) {
    extraction.checkDeadline();
    return { ok: true, metadata, frames: times.map((at, index) => ({ at, mimeType: 'image/jpeg', bytes: frames[index]! })) };
  }
  const sheets = await assembleSheets({ sheetLayouts, plan, ffmpeg: binaries.ffmpeg }, extraction);
  extraction.checkDeadline();
  return { ok: true, metadata, frames: [], sheets: sheetLayouts.map((sheet, index) => ({ ...sheet, mimeType: 'image/jpeg', bytes: sheets[index]! })) };
}

async function removeWorkspace({ directory }: { directory?: string }): Promise<VideoFrameFailure | undefined> {
  try { if (directory) await rm(directory, { recursive: true, force: true }); }
  catch { return { ok: false, reason: 'invalid', message: 'Video preview temporary files could not be removed.' }; }
  return undefined;
}

export function createFfmpegVideoFrameExtractor(
  { findBinaries = findVideoBinaries, runProcess = runLowPriorityVideoProcess, nowMs = () => performance.now(), lock = defaultExtractionLock, env, platform }: { lock?: VideoExtractionLock; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; findBinaries?: VideoBinaryFinder; runProcess?: VideoProcessRunner; nowMs?: (required: Record<string, never>, optional: Record<string, never>) => number },
  _optional: Record<string, never> = {},
): VideoFrameExtractor {
  const deps: ExtractorDeps = { findBinaries, runProcess, nowMs: () => nowMs({}, {}), env, platform };
  return { extract: async ({ bytes }, options): Promise<VideoFrameResult> => {
    const rejected = rejectVideoInput({ bytes });
    if (rejected) return rejected;
    const release = lock.tryAcquire({}, {});
    if (!release) return { ok: false, reason: 'busy', message: 'Video preview is busy. Try again after the current extraction finishes.' };
    const deadline = deps.nowMs() + VIDEO_EXTRACTION_TIMEOUT_MS;
    const workspace: { directory?: string } = {};
    const result = await extractLocked({ bytes, options, deadline, workspace }, deps).catch(toVideoFailure);
    // Neither step throws, so the lock is always released, and only after cleanup.
    const cleanupFailure = await removeWorkspace(workspace);
    release();
    return cleanupFailure ?? result;
  } };
}
