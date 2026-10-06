import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { delimiter, isAbsolute, join } from 'node:path';
import { sniffContentType } from './content-type-sniffer.js';
import { getVideoFrameEdge, parseVideoProbe, planVideoFrames, planVideoContactSheets, VIDEO_EXTRACTION_TIMEOUT_MS, VIDEO_MAX_SHEET_BYTES, VIDEO_MAX_FRAME_BYTES, VIDEO_MAX_INPUT_BYTES, VIDEO_MAX_OUTPUT_BYTES, type VideoFrameExtractor, type VideoFrameResult } from './video-frames.js';

export interface VideoBinaries { readonly nice: string; readonly ffmpeg: string; readonly ffprobe: string }
export type VideoBinaryFinder = (required: Record<string, never>, optional: Record<string, never>) => Promise<VideoBinaries | undefined>;
export type VideoProcessRunner = (required: { command: string; args: readonly string[] }, optional: { timeoutMs: number; maxOutputBytes: number; signal?: AbortSignal }) => Promise<Uint8Array>;
class VideoProcessError extends Error {
  constructor(readonly reason: 'unavailable' | 'timeout' | 'canceled' | 'invalid', message: string) { super(message); }
}

async function executable(required: { name: string }, { configured }: { configured?: string | undefined } = {}): Promise<string | undefined> {
  const candidates = configured ? [configured] : [
    ...(process.env['PATH'] ?? '').split(delimiter).filter(isAbsolute).map(directory => join(directory, required.name)),
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
export const findVideoBinaries: VideoBinaryFinder = async (_required, _optional) => {
  if (process.platform === 'win32') return undefined; // Never silently omit the low-priority guarantee.
  const nice = await executable({ name: 'nice' }, {});
  const ffmpeg = await executable({ name: 'ffmpeg' }, { configured: process.env['FFMPEG_PATH'] });
  const ffprobe = await executable({ name: 'ffprobe' }, { configured: process.env['FFPROBE_PATH'] });
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

// Shared across ALL adapter instances: a second catalog/tenant cannot run a second ffmpeg in this
// process. Fail busy instead of holding arbitrary numbers of uploaded videos in a pending queue.
let extracting = false;
const UNAVAILABLE = 'video preview unavailable on this host (nice, ffmpeg and ffprobe are required).';
// Eight amortizes process/seek overhead while bounding expensive source decoders to
// one eighth of the 64-frame maximum. Thread caps alone do not bound decoder memory.
// This is a decoder-count limit, not a measured host RSS guarantee.
const SOURCE_BATCH_SIZE = 8;
const localInputFlags = ['-threads', '1', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm'];

export function createFfmpegVideoFrameExtractor(
  { findBinaries = findVideoBinaries, runProcess = runLowPriorityVideoProcess, nowMs = () => performance.now() }: { findBinaries?: VideoBinaryFinder; runProcess?: VideoProcessRunner; nowMs?: (required: Record<string, never>, optional: Record<string, never>) => number },
  _optional: Record<string, never> = {},
): VideoFrameExtractor {
  return { extract: async ({ bytes }, options): Promise<VideoFrameResult> => {
    if (bytes.byteLength > VIDEO_MAX_INPUT_BYTES) return { ok: false, reason: 'too-large', message: `Video preview input exceeds ${VIDEO_MAX_INPUT_BYTES} bytes.` };
    const type = sniffContentType({ bytes });
    if (type !== 'video/mp4' && type !== 'video/webm') return { ok: false, reason: 'invalid', message: 'Video preview requires stored MP4 or WebM bytes.' };
    if (extracting) return { ok: false, reason: 'busy', message: 'Video preview is busy. Try again after the current extraction finishes.' };
    extracting = true;
    const deadline = nowMs({}, {}) + VIDEO_EXTRACTION_TIMEOUT_MS;
    let directory: string | undefined;
    try {
      if (options.signal?.aborted) throw new VideoProcessError('canceled', 'Video preview canceled.');
      if (options.layout !== undefined && options.layout !== 'frames' && options.layout !== 'sheet') throw new VideoProcessError('invalid', 'Video layout must be frames or sheet.');
      const binaries = await findBinaries({}, {});
      if (!binaries) return { ok: false, reason: 'unavailable', message: UNAVAILABLE };
      directory = await mkdtemp(join(tmpdir(), 'video-preview-'));
      const input = join(directory, 'input');
      await writeFile(input, bytes, { mode: 0o600, flag: 'wx' });
      const checkDeadline = () => {
        if (options.signal?.aborted) throw new VideoProcessError('canceled', 'Video preview canceled.');
        if (nowMs({}, {}) >= deadline) throw new VideoProcessError('timeout', 'Video preview timed out.');
      };
      const run = (required: { binary: string; args: readonly string[] }, optional: { maxOutputBytes: number }) => {
        checkDeadline();
        const timeoutMs = deadline - nowMs({}, {});
        if (timeoutMs <= 0) throw new VideoProcessError('timeout', 'Video preview timed out.');
        return runProcess({ command: binaries.nice, args: ['-n', '19', required.binary, ...required.args] },
          { timeoutMs, maxOutputBytes: optional.maxOutputBytes, ...(options.signal ? { signal: options.signal } : {}) });
      };
      const probe = await run({ binary: binaries.ffprobe, args: ['-v', 'error', ...localInputFlags, '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height,duration:stream_disposition=attached_pic', '-of', 'json', '-i', input] }, { maxOutputBytes: 64 * 1024 });
      const metadata = parseVideoProbe({ output: Buffer.from(probe).toString('utf8'), sizeBytes: bytes.byteLength }, {});
      const times = planVideoFrames({ duration: metadata.duration }, options);
      const sheetLayouts = options.layout === 'sheet' ? planVideoContactSheets({ times }, {}) : undefined;
      const edge = sheetLayouts?.[0]?.tileEdgePx ?? getVideoFrameEdge({ frameCount: times.length }, {});
      const imageCount = sheetLayouts?.length ?? times.length;
      const perImageLimit = sheetLayouts ? VIDEO_MAX_SHEET_BYTES : VIDEO_MAX_FRAME_BYTES;
      // Preallocate a fair share for each output, so all file limits together fit the total budget.
      const fileLimit = Math.min(perImageLimit, Math.floor(VIDEO_MAX_OUTPUT_BYTES / imageCount));
      const paths = Array.from({ length: imageCount }, (_, index) => join(directory!, `image-${index}.jpg`));
      const tilePaths = sheetLayouts ? times.map((_, index) => join(directory!, `tile-${index}.jpg`)) : paths;
      // Intermediates have their own bounded allocation; never spend a sheet's 2 MiB per tile.
      const tileLimit = sheetLayouts ? Math.min(VIDEO_MAX_FRAME_BYTES, Math.floor(VIDEO_MAX_OUTPUT_BYTES / times.length)) : fileLimit;
      const ffmpegArgs = () => ['-hide_banner', '-loglevel', 'error', '-nostdin', '-filter_threads', '1', '-filter_complex_threads', '1'];
      // Framerate mode is per output (ffmpeg >=5.1); preserve each selected frame
      // for both source extraction and contact-sheet assembly without resync.
      const appendOutput = ({ args, label, path, limit }: { args: string[]; label: string; path: string; limit: number }) => args.push(
        '-map', label, '-an', '-sn', '-dn', '-frames:v', '1', '-c:v', 'mjpeg', '-threads', '1',
        '-q:v', '5', '-fs', String(limit), '-f', 'mjpeg', '-fps_mode', 'passthrough', path,
      );
      const readImage = async ({ path, perImageLimit, fileLimit }: { path: string; perImageLimit: number; fileLimit: number }) => {
        checkDeadline();
        // -fs is packet-granular: check size before allocating and refuse overshoot.
        const size = (await stat(path)).size;
        checkDeadline();
        if (size > perImageLimit) throw new VideoProcessError('invalid', 'Video preview exceeded its output limit.');
        if (size > fileLimit) throw new VideoProcessError('invalid', 'Video preview exceeded its total output limit (8 MiB).');
        const image = await readFile(path);
        checkDeadline();
        if (image.length < 4 || image[0] !== 255 || image[1] !== 216 || image[image.length - 2] !== 255 || image[image.length - 1] !== 217) {
          throw new VideoProcessError('invalid', 'Video preview returned no JPEG frame.');
        }
        return image;
      };
      const scale = `scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease`;
      const images: Uint8Array[] = [];
      let tileBytes = 0;
      // Await exit and validate this batch before starting another: <=8 source contexts alive.
      for (let offset = 0; offset < times.length; offset += SOURCE_BATCH_SIZE) {
        checkDeadline();
        const batch = times.slice(offset, offset + SOURCE_BATCH_SIZE);
        const args = ffmpegArgs();
        // Seek each source input before opening it; no full-clip select/decode scan.
        for (const at of batch) args.push(...localInputFlags, '-ss', String(at), '-i', input);
        const filters = batch.map((_, index) => `[${index}:V:0]trim=end_frame=1,setpts=PTS-STARTPTS,${scale},setsar=1${sheetLayouts ? `,pad=${edge}:${edge}:(ow-iw)/2:(oh-ih)/2:color=black` : ''}[tile${index}]`);
        args.push('-filter_complex', filters.join(';'));
        for (let index = 0; index < batch.length; index++) appendOutput({ args, label: `[tile${index}]`, path: tilePaths[offset + index]!, limit: tileLimit });
        // Raw MJPEG with one frame writes one JPEG through the file muxer (-fs applies).
        await run({ binary: binaries.ffmpeg, args }, { maxOutputBytes: 64 * 1024 });
        checkDeadline();
        for (let index = 0; index < batch.length; index++) {
          const image = await readImage({ path: tilePaths[offset + index]!, perImageLimit: VIDEO_MAX_FRAME_BYTES, fileLimit: tileLimit });
          tileBytes += image.byteLength;
          if (tileBytes > VIDEO_MAX_OUTPUT_BYTES) throw new VideoProcessError('invalid', 'Video preview exceeded its total output limit (8 MiB).');
          if (!sheetLayouts) images.push(image); // Sheet tiles remain on disk, not retained in memory.
        }
      }
      if (sheetLayouts) {
        let offset = 0;
        let outputBytes = 0;
        for (const [index, sheet] of sheetLayouts.entries()) {
          checkDeadline();
          const inputs = tilePaths.slice(offset, offset + sheet.tiles.length);
          const args = ffmpegArgs();
          // These decoders see only small, validated JPEGs, never the source video.
          for (const path of inputs) args.push('-threads', '1', '-protocol_whitelist', 'file', '-format_whitelist', 'mjpeg', '-f', 'mjpeg', '-i', path);
          const filters = inputs.map((_, tile) => `[${tile}:v:0]trim=end_frame=1,setpts=PTS-STARTPTS[tile${tile}]`);
          const labels = inputs.map((_, tile) => `[tile${tile}]`).join('');
          const positions = sheet.tiles.map(tile => `${(tile.column - 1) * edge}_${(tile.row - 1) * edge}`).join('|');
          // Pad the grid if unused bottom-right cells do not establish the full extent.
          filters.push(`${labels}${inputs.length === 1 ? 'null' : `xstack=inputs=${inputs.length}:layout=${positions}:fill=black:shortest=1`},pad=${sheet.columns * edge}:${sheet.rows * edge}:0:0:color=black[sheet]`);
          args.push('-filter_complex', filters.join(';'));
          appendOutput({ args, label: '[sheet]', path: paths[index]!, limit: fileLimit });
          await run({ binary: binaries.ffmpeg, args }, { maxOutputBytes: 64 * 1024 });
          const image = await readImage({ path: paths[index]!, perImageLimit, fileLimit });
          outputBytes += image.byteLength;
          if (outputBytes > VIDEO_MAX_OUTPUT_BYTES) throw new VideoProcessError('invalid', 'Video preview exceeded its total output limit (8 MiB).');
          images.push(image);
          // Retire tiles as soon as their sheet is verified; finally still cleans on any failure.
          for (const path of inputs) { checkDeadline(); await rm(path); }
          offset += inputs.length;
        }
      }
      checkDeadline();
      if (sheetLayouts) return { ok: true, metadata, frames: [], sheets: sheetLayouts.map((sheet, index) => ({ ...sheet, mimeType: 'image/jpeg', bytes: images[index]! })) };
      return { ok: true, metadata, frames: times.map((at, index) => ({ at, mimeType: 'image/jpeg', bytes: images[index]! })) };
    } catch (error) {
      const reason = error instanceof VideoProcessError ? error.reason : 'invalid';
      return { ok: false, reason, message: reason === 'unavailable' ? UNAVAILABLE : error instanceof VideoProcessError ? error.message : 'Video preview could not read or decode this clip.' };
    } finally {
      try { if (directory) await rm(directory, { recursive: true, force: true }); }
      catch { return { ok: false, reason: 'invalid', message: 'Video preview temporary files could not be removed.' }; }
      finally { extracting = false; }
    }
  } };
}
