/**
 * @file ffmpeg adapter for {@link MediaTranscoderPort}: a local ffmpeg binary, run at nice 19 on
 * private temp files, one conversion at a time per lock.
 *
 * Reuses `video-frames.ffmpeg.ts`'s binary discovery, low-priority process runner (process-group
 * kill, timeout, abort) and lock type. Arguments are always an array, never a shell string, and
 * input parsing is restricted to local files and the container demuxers phones and browsers produce.
 * Since the move out of the CMS package those three arrive as host-supplied ports rather than imports.
 *
 * Why-comment — conversion is a host capability with local process risk, not a dependency of
 * portable media services. The host hands in binary discovery, the process runner (process-group
 * kill, timeout, abort), the lock, the byte sniffer and the policy, so this file imports no media
 * package. ffmpeg is never bundled.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MediaTranscoderPort, VideoTranscodeFailureReason, VideoTranscodeResult } from "@jini-ai/core/contracts/site/cms-media";

/** Local executables the converter needs; ffprobe ships with ffmpeg and is only located, never run here. */
export interface VideoBinaries { readonly nice: string; readonly ffmpeg: string; readonly ffprobe: string }
export type VideoBinaryFinder = (required: Record<string, never>, optional: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform }) => Promise<VideoBinaries | undefined>;
export type VideoProcessRunner = (required: { command: string; args: readonly string[] }, optional: { timeoutMs: number; maxOutputBytes: number; signal?: AbortSignal }) => Promise<Uint8Array>;
export interface VideoExtractionLock {
  /** Synchronous acquisition prevents races before the first awaited step. */
  tryAcquire(required: Record<string, never>, optional: Record<string, never>): (() => void) | undefined;
}

/** Long clips at nice 19 are slow; a hard bound still stops a stuck decoder. */
export const VIDEO_TRANSCODE_TIMEOUT_MS = 30 * 60_000;
const DIAGNOSTIC_OUTPUT_BYTES = 64 * 1024;

/**
 * The exact ffmpeg argument list for a web-safe MP4. Pure, so it is tested without a binary.
 * Beyond the planned codec flags: `-pix_fmt yuv420p` because phone HEVC is often 10-bit and a
 * 10-bit H.264 stream does not play in browsers; `-maxrate/-bufsize` cap the bitrate of large
 * videos; `-fs` stops writing past the output cap; `-n` never overwrites an existing file.
 * @complexity O(1).
 */
export function buildVideoTranscodeArgs(
  { input, output, maxOutputBytes }: { input: string; output: string; maxOutputBytes: number },
  _optional: Record<string, never> = {},
): string[] {
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    "-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm",
    "-i", input,
    // First video and (if any) first audio stream; subtitles/data tracks are dropped.
    "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "8M", "-bufsize", "16M",
    "-vf", "scale='min(1920,iw)':-2", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart", "-fs", String(maxOutputBytes), "-f", "mp4", output,
  ];
}

/** Everything the host must supply; none of it is optional so no ambient lookup can sneak in. */
export interface FfmpegMediaTranscoderRequired {
  findBinaries: VideoBinaryFinder;
  runProcess: VideoProcessRunner;
  /** Share with the frame extractor's lock to keep one ffmpeg per process; defaults to a per-adapter lock. The host now supplies it, so there is no default here. */
  lock: VideoExtractionLock;
  /** Names the real type of the converted bytes; only an MP4 result is accepted. */
  sniffContentType: (required: { bytes: Uint8Array }) => string | undefined;
  /** Largest original accepted, and the default cap on the converted output. */
  maxInputBytes: number;
  /** Plain-words message per failure reason, owned by the host's media policy. */
  messages: Readonly<Record<VideoTranscodeFailureReason, string>>;
  /** Environment handed to binary discovery. */
  env: NodeJS.ProcessEnv;
}

export interface FfmpegMediaTranscoderOptional {
  /** Directory for private per-conversion temp folders (defaults to the OS temp directory). */
  tempDir?: string | undefined;
  timeoutMs?: number | undefined;
}

type Failure = Extract<VideoTranscodeResult, { ok: false }>;
const PROCESS_REASONS: ReadonlySet<string> = new Set(["unavailable", "timeout", "canceled", "invalid"]);

interface RunRequest {
  binaries: VideoBinaries; directory: string; input: Uint8Array; signal: AbortSignal | undefined;
  maxOutputBytes: number; timeoutMs: number; runProcess: VideoProcessRunner;
  sniffContentType: FfmpegMediaTranscoderRequired["sniffContentType"]; failure: (reason: VideoTranscodeFailureReason) => Failure;
}

/** Writes the input, runs ffmpeg, and reads back a size-checked MP4. Temp files are the caller's to remove. */
async function transcodeInDirectory({ binaries, directory, input, signal, maxOutputBytes, timeoutMs, runProcess, sniffContentType, failure }: RunRequest): Promise<VideoTranscodeResult> {
  const inputPath = join(directory, "input");
  const outputPath = join(directory, "output.mp4");
  await writeFile(inputPath, input, { mode: 0o600, flag: "wx" });
  const args = buildVideoTranscodeArgs({ input: inputPath, output: outputPath, maxOutputBytes });
  await runProcess({ command: binaries.nice, args: ["-n", "19", binaries.ffmpeg, ...args] },
    { timeoutMs, maxOutputBytes: DIAGNOSTIC_OUTPUT_BYTES, ...(signal ? { signal } : {}) });
  // -fs is packet-granular, so check the real size before loading the file.
  if ((await stat(outputPath)).size > maxOutputBytes) return failure("too-large");
  const bytes = new Uint8Array(await readFile(outputPath));
  return sniffContentType({ bytes }) === "video/mp4" ? { ok: true, bytes } : failure("invalid");
}

/** The shared runner rejects with an error carrying `reason`; anything else is an unreadable clip. */
function reasonOf(error: unknown): VideoTranscodeFailureReason {
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === "string" && PROCESS_REASONS.has(reason) ? reason as VideoTranscodeFailureReason : "invalid";
}

/** Refusals that need neither a binary nor scratch space. */
function earlyRefusal(
  { input, maxInputBytes }: { input: Uint8Array; maxInputBytes: number },
  { signal }: { signal: AbortSignal | undefined },
): VideoTranscodeFailureReason | undefined {
  if (signal?.aborted) return "canceled";
  return input.byteLength > maxInputBytes ? "too-large" : undefined;
}

// Web-safe video conversion through a local ffmpeg binary (optional host codec).
/**
 * Creates the ffmpeg-backed transcoder. Missing ffmpeg (or nice/ffprobe, which ship with it on
 * supported hosts; Windows is never supported because nice is required) is reported with the
 * host's own "unavailable" message. Temp files are removed in every outcome.
 * @complexity O(n) in video bytes plus one ffmpeg process.
 */
export function createFfmpegMediaTranscoder(
  { findBinaries, runProcess, lock, sniffContentType, maxInputBytes, messages, env }: FfmpegMediaTranscoderRequired,
  { tempDir = tmpdir(), timeoutMs = VIDEO_TRANSCODE_TIMEOUT_MS }: FfmpegMediaTranscoderOptional = {},
): MediaTranscoderPort {
  const failure = (reason: VideoTranscodeFailureReason): Failure => ({ ok: false, reason, message: messages[reason] });
  // Why-comment — conversion is a host capability with local process risk, not a dependency of portable media services.
  return {
    async transcode({ input }, { signal, maxOutputBytes = maxInputBytes } = {}) {
      const refused = earlyRefusal({ input, maxInputBytes }, { signal });
      if (refused) return failure(refused);
      const binaries = await findBinaries({}, { env });
      if (!binaries) return failure("unavailable");
      const release = lock.tryAcquire({}, {});
      if (!release) return failure("busy");
      let directory: string | undefined;
      try {
        directory = await mkdtemp(join(tempDir, "video-transcode-"));
        return await transcodeInDirectory({ binaries, directory, input, signal, maxOutputBytes, timeoutMs, runProcess, sniffContentType, failure });
      } catch (error) {
        return failure(reasonOf(error));
      } finally {
        // Cleanup failure must not mask the result; the folder name is unique and private.
        if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        release();
      }
    },
  };
}
