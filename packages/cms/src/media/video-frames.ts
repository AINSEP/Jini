/** Video preview contract and sampling policy, independent of a host, codec or AI provider. */
export const VIDEO_MAX_FRAMES = 64;
export const VIDEO_DEFAULT_FRAMES = 16;
export const VIDEO_MAX_EDGE_PX = 768;
export const VIDEO_MAX_INPUT_BYTES = 64 * 1024 * 1024;
export const VIDEO_MAX_FRAME_BYTES = 512 * 1024;
/** Aggregate raw JPEG payload budget; base64 expands this to about 10.67 MiB plus metadata. */
export const VIDEO_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const VIDEO_MAX_SHEET_BYTES = 2 * 1024 * 1024;
export const VIDEO_MAX_SHEETS = 4;
// One shared deadline: serial source batches and JPEG sheet assembly need launch/seek
// headroom at nice 19. This remains a hard bound, not a per-process allowance.
export const VIDEO_EXTRACTION_TIMEOUT_MS = 60_000;

export interface VideoMetadata {
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly codec: string;
  readonly container: string;
  readonly sizeBytes: number;
  readonly hasAudio: boolean;
}
export interface VideoFrame { readonly at: number; readonly mimeType: 'image/jpeg'; readonly bytes: Uint8Array }
export interface VideoSheetTile { readonly index: number; readonly row: number; readonly column: number; readonly at: number }
export interface VideoSheetLayout {
  readonly columns: number;
  readonly rows: number;
  readonly tileEdgePx: number;
  /** One-based row-major positions; timestamp order and repetitions are preserved. */
  readonly tiles: readonly VideoSheetTile[];
}
export interface VideoContactSheet extends VideoSheetLayout { readonly mimeType: 'image/jpeg'; readonly bytes: Uint8Array }
export interface VideoFrameOptions {
  readonly layout?: 'frames' | 'sheet';
  readonly frames?: number;
  readonly at?: readonly number[];
  readonly every?: number;
  readonly start?: number;
  readonly signal?: AbortSignal;
}
export type VideoFrameResult =
  | { readonly ok: true; readonly metadata: VideoMetadata; readonly frames: readonly VideoFrame[]; readonly sheets?: readonly VideoContactSheet[] }
  | { readonly ok: false; readonly reason: 'unavailable' | 'busy' | 'too-large' | 'timeout' | 'canceled' | 'invalid'; readonly message: string };
/** Implementations return <=64 sampled frames: separate JPEGs <=512KiB or <=4 sheets <=2MiB.
 * The count-dependent pixel policy and <=8MiB aggregate budget apply in both modes.
 * Sheet mode returns frames: [] plus sheets; separate mode omits sheets. Overflow fails in full.
 * Inputs are authorized bytes, never caller paths. No provider or CMS-owner concepts live here. */
export interface VideoFrameExtractor {
  extract(required: { bytes: Uint8Array }, optional: VideoFrameOptions): Promise<VideoFrameResult>;
}

/** Keep sixteen square 768px images worth of pixels (about 12.6k tokens at pixels/750).
 * Even pixel sizes are codec-friendly; flooring never increases the budget. */
export function getVideoFrameEdge(
  { frameCount }: { frameCount: number }, _optional: Record<string, never> = {},
): number {
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > VIDEO_MAX_FRAMES) throw new Error('Frame count must be an integer from 1 to 64.');
  return 2 * Math.floor(VIDEO_MAX_EDGE_PX * Math.min(1, Math.sqrt(VIDEO_DEFAULT_FRAMES / frameCount)) / 2);
}

/** Grid pixels, including black unused cells, share the separate-frame pixel budget.
 * Metadata provides labels without requiring a host font or ffmpeg drawtext support. */
export function planVideoContactSheets(
  { times }: { times: readonly number[] }, _optional: Record<string, never> = {},
): VideoSheetLayout[] {
  if (!Array.isArray(times) || times.length < 1 || times.length > VIDEO_MAX_FRAMES || times.some(time => typeof time !== 'number' || !Number.isFinite(time) || time < 0)) {
    throw new Error('Sheets require 1 to 64 finite nonnegative timestamps.');
  }
  const groups: VideoSheetLayout[] = [];
  for (let offset = 0; offset < times.length; offset += 16) {
    const group = times.slice(offset, offset + 16);
    const columns = Math.min(4, Math.ceil(Math.sqrt(group.length)));
    const rows = Math.ceil(group.length / columns);
    groups.push({ columns, rows, tileEdgePx: 0, tiles: group.map((at, index) => ({ index: index + 1, row: Math.floor(index / columns) + 1, column: index % columns + 1, at })) });
  }
  const frameCount = groups.reduce((sum, group) => sum + group.columns * group.rows, 0);
  const tileEdgePx = getVideoFrameEdge({ frameCount }, {});
  return groups.map(group => ({ ...group, tileEdgePx }));
}

/** Avoid seeking to exact EOF, which commonly has no decodable frame. Preserve explicit order,
 * including repeated timestamps, so image positions continue to match the requested positions.
 * With every and no count, stop when the next timestamp cannot fit (always emit the first clamped
 * position). An explicit count preserves the requested count, clamping positions beyond the clip.
 * start only affects every; at overrides count/start, but at + every is invalid. */
export function planVideoFrames(
  { duration }: { duration: number },
  { frames, at, every, start = 0 }: Pick<VideoFrameOptions, 'frames' | 'at' | 'every' | 'start'> = {},
): number[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Video duration must be positive and finite.');
  if (frames !== undefined && (typeof frames !== 'number' || !Number.isFinite(frames))) throw new Error('Frame count must be finite.');
  if (frames !== undefined && frames < 0) throw new Error('Frame count must be nonnegative.');
  if (at !== undefined && (!Array.isArray(at) || !at.length || at.some(time => typeof time !== 'number' || !Number.isFinite(time)))) {
    throw new Error('at must contain finite timestamps in seconds.');
  }
  if (at?.some(time => time < 0)) throw new Error('at timestamps must be nonnegative.');
  if (every !== undefined && (typeof every !== 'number' || !Number.isFinite(every) || every <= 0)) throw new Error('every must be a positive finite number of seconds.');
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) throw new Error('start must be a nonnegative finite number of seconds.');
  if (at !== undefined && every !== undefined) throw new Error('every cannot be combined with at.');
  const inset = Math.min(0.1, duration / 10);
  const end = duration - inset;
  if (at !== undefined) {
    return at.slice(0, VIDEO_MAX_FRAMES).map(time => Math.max(0, Math.min(end, time)));
  }
  const count = Math.max(1, Math.min(VIDEO_MAX_FRAMES, Math.floor(frames ?? (every !== undefined ? VIDEO_MAX_FRAMES : VIDEO_DEFAULT_FRAMES))));
  if (every !== undefined) {
    const times: number[] = [];
    for (let index = 0; index < count; index++) {
      const time = start + index * every;
      // Multiplication can round a fitting boundary just above end. Only tolerate arithmetic
      // roundoff; a materially later timestamp must not add an EOF sample when count is omitted.
      const tolerance = Number.EPSILON * Math.max(end, Math.abs(time)) * 4;
      if (frames === undefined && index > 0 && (!Number.isFinite(time) || time - end > tolerance)) break;
      times.push(Math.min(end, time));
    }
    return times;
  }
  if (count === 1) return [duration / 2];
  return Array.from({ length: count }, (_, index) => inset + (end - inset) * index / (count - 1));
}

/** Parse only the ffprobe fields requested by the adapter. File size is measured from authorized
 * input bytes, never from a possibly stale container header. Cover art is not a video stream. */
export function parseVideoProbe(
  { output, sizeBytes }: { output: string; sizeBytes: number }, _optional: Record<string, never> = {},
): VideoMetadata {
  const raw = JSON.parse(output) as { streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string; disposition?: { attached_pic?: number } }>; format?: { duration?: string; format_name?: string } };
  const streams = Array.isArray(raw?.streams) ? raw.streams : [];
  const video = streams.find(stream => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1);
  const formatDuration = Number(raw?.format?.duration);
  const duration = Number.isFinite(formatDuration) && formatDuration > 0 ? formatDuration : Number(video?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0 || !Number.isInteger(video.width) || !Number.isInteger(video.height) || video.width! <= 0 || video.height! <= 0) {
    throw new Error('Video metadata is missing or invalid.');
  }
  return { duration, width: video.width!, height: video.height!, codec: video.codec_name ?? 'unknown', container: raw.format?.format_name ?? 'unknown', sizeBytes, hasAudio: streams.some(stream => stream.codec_type === 'audio') };
}
