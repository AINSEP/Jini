/**
 * @file Web-safe video conversion: the transcoder port, the import-time decision rule, and the
 * use-case that stores a converted copy beside its original.
 *
 * Why a separate copy rather than a replacement: an HEVC `.mov` from a phone often does not play in
 * a browser, but it is still the owner's original. Conversion therefore always writes a NEW media
 * item ("<title> (web)") and asks the host to record that it was derived from the original; the
 * original row and its bytes are never touched. No codec, binary or vendor lives in this file —
 * the ffmpeg adapter lives in an agent plugin and is one adapter of {@link MediaTranscoderPort}.
 */
import type { MediaTranscoderPort, StagedMediaFile, StagedMediaTranscoderPort, VideoTranscodeFailureReason, VideoTranscodeTarget } from "@jini-ai/core/contracts/site/cms-media";
import { mintToolErrorId } from "@jini-ai/core/errors/error-id";
import { MEDIA_MAX_UPLOAD_BYTES } from "@jini-ai/core/contracts/site/media-upload-limits";
import { sniffContentType } from "./content-type-sniffer.js";
import { getMediaById, rollbackUploadedMedia, uploadMedia, uploadStagedVideo, type UploadMediaDeps } from "./media-service.js";
import type { MediaRecord } from "./types.js";

const MIB = 1024 * 1024;
/** Owner rule (2026-10-31): a video at or under 50 MiB is kept as-is on import. */
export const VIDEO_TRANSCODE_THRESHOLD_BYTES = MEDIA_MAX_UPLOAD_BYTES;
/** Largest original this package will hand to a transcoder; the bytes are held in memory. */
export const VIDEO_TRANSCODE_MAX_INPUT_BYTES = 2 * 1024 * MIB;

/** Host-owned record that `derivedId` is a converted copy of `originalId` (provenance link). */
export type DerivedMediaLinkPort = (
  required: { workspaceId: string; originalId: string; derivedId: string; target: VideoTranscodeTarget },
  optional?: Record<string, never>,
) => Promise<void>;

export type VideoConversionFailureReason = VideoTranscodeFailureReason | "not-video" | "trashed";

/** The one place conversion wording lives; adapters reuse it so the owner always reads the same words. */
export const VIDEO_CONVERSION_MESSAGES: Readonly<Record<VideoConversionFailureReason, string>> = {
  unavailable: "Video conversion needs ffmpeg on this computer.",
  busy: "Another video is being converted right now. Try again when it finishes.",
  "too-large": "This video is too large to convert.",
  timeout: "Video conversion took too long and was stopped.",
  canceled: "Video conversion was canceled.",
  invalid: "This video could not be converted. The file may be damaged or in a format that cannot be read.",
  "not-video": "Only videos can be converted for the web, and this item is not a video.",
  trashed: "This video is in the trash. Restore it before converting it.",
};

/** A conversion failure the owner can read; `message` ends with the `ERR-` id for support. */
export class VideoConversionError extends Error {
  constructor(readonly reason: VideoConversionFailureReason, readonly errorId: string, plainMessage: string) {
    super(`${plainMessage} (${errorId})`);
    this.name = "VideoConversionError";
  }
}

/** Normalizes `Video/MP4; codecs=...` to `video/mp4`. */
const baseType = (contentType: string | undefined) => (contentType ?? "").split(";")[0]!.trim().toLowerCase();
const isVideoType = (contentType: string | undefined) => baseType(contentType).startsWith("video/");

/**
 * Import-time rule: convert only a video strictly larger than the threshold (default 50 MiB).
 * Smaller videos are kept as uploaded; the host may offer a manual "Convert for web" action.
 * @returns true only for a video over the threshold; never for any other type. @complexity O(1).
 */
export function shouldTranscodeOnImport(
  required: { sizeBytes: number; contentType: string },
  { thresholdBytes = VIDEO_TRANSCODE_THRESHOLD_BYTES }: { thresholdBytes?: number } = {},
): boolean {
  return isVideoType(required.contentType) && required.sizeBytes > thresholdBytes;
}

export interface ConvertMediaVideoDeps extends UploadMediaDeps {
  transcoder: MediaTranscoderPort;
  linkDerivedMedia: DerivedMediaLinkPort;
  /** Random source for `ERR-` ids; defaults to Web Crypto, which Node and browsers both provide. */
  randomHex?: ((required: { bytes: number }) => string) | undefined;
}
export interface ConvertMediaVideoRequired {
  deps: ConvertMediaVideoDeps;
  input: { workspaceId: string; mediaId: string; createdByPrincipal: string };
}
export interface ConvertMediaVideoOptional {
  signal?: AbortSignal | undefined;
  /** Refuse originals larger than this (default 2 GiB). */
  maxInputBytes?: number | undefined;
  /** Largest converted file to store (default: the input maximum). */
  maxOutputBytes?: number | undefined;
}

const webCryptoHex = ({ bytes }: { bytes: number }) =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, "0")).join("");

type Fail = (reason: VideoConversionFailureReason, message?: string) => VideoConversionError;
function failureFactory({ randomHex = webCryptoHex }: Pick<ConvertMediaVideoDeps, "randomHex">): Fail {
  return (reason, message = VIDEO_CONVERSION_MESSAGES[reason]) => new VideoConversionError(reason, mintToolErrorId({ randomHex }), message);
}

function throwIfCanceled({ signal, fail }: { signal: AbortSignal | undefined; fail: Fail }): void {
  if (signal?.aborted) throw fail("canceled");
}

/** Loads the original and its bytes, refusing trashed, oversize and non-video items before any decode. */
async function readOriginalVideo(
  { deps, input, maxInputBytes, fail }: { deps: ConvertMediaVideoDeps; input: ConvertMediaVideoRequired["input"]; maxInputBytes: number; fail: Fail },
): Promise<{ media: MediaRecord; bytes: Uint8Array }> {
  const { media, storageKey } = await findOriginalBlob({ deps, input, fail });
  const bytes = await readBoundedBytes({ deps, storageKey, maxInputBytes, fail });
  // Legacy rows carry no recorded type; sniff their stored bytes instead.
  if (media.source.contentType === undefined && !isVideoType(sniffContentType({ bytes }))) throw fail("not-video");
  return { media, bytes };
}

/** The refusals that need no bytes: a trashed item, a recorded non-video type, a missing blob. */
async function findOriginalBlob(
  { deps, input, fail }: { deps: Pick<ConvertMediaVideoDeps, "mediaRepo" | "blobRepo">; input: ConvertMediaVideoRequired["input"]; fail: Fail },
  _optional = {},
): Promise<{ media: MediaRecord; storageKey: string }> {
  const { media } = await getMediaById({ deps, input: { workspaceId: input.workspaceId, id: input.mediaId } });
  if (media.status === "trashed") throw fail("trashed");
  // A recorded type is authoritative; refuse a known non-video before reading its bytes.
  if (media.source.contentType !== undefined && !isVideoType(media.source.contentType)) throw fail("not-video");
  const blob = await deps.blobRepo.findByHash({ workspaceId: input.workspaceId, sha256: media.source.sha256 });
  if (!blob) throw fail("invalid", "The original video file is missing from storage, so it cannot be converted.");
  return { media, storageKey: blob.storageKey };
}

/** Reads the stored bytes only once the reported size is within the limit, then checks the real length. */
async function readBoundedBytes(
  { deps, storageKey, maxInputBytes, fail }: { deps: ConvertMediaVideoDeps; storageKey: string; maxInputBytes: number; fail: Fail },
  _optional = {},
): Promise<Uint8Array> {
  const tooLarge = () => fail("too-large", `This video is too large to convert. The limit is ${Math.floor(maxInputBytes / MIB)} MB.`);
  // sizeOf avoids loading a multi-GB payload only to refuse it; the length check below still guards.
  const size = await deps.blobStore.sizeOf?.({ storageKey });
  if (typeof size === "number" && size > maxInputBytes) throw tooLarge();
  const bytes = await deps.blobStore.get({ storageKey });
  if (bytes.byteLength > maxInputBytes) throw tooLarge();
  return bytes;
}

/** Stores the converted bytes as a new item and links it to the original; a failed link removes the new item. */
async function storeConvertedCopy(
  { deps, input, original, storeUpload }: { deps: UploadMediaDeps & Pick<ConvertMediaVideoDeps, "linkDerivedMedia">; input: ConvertMediaVideoRequired["input"]; original: MediaRecord; storeUpload: (filename: string) => Promise<{ media: MediaRecord }> },
  { signal }: { signal?: AbortSignal | undefined } = {},
): Promise<MediaRecord> {
  // uploadMedia derives the title from the filename; a path separator would be cut from the
  // stored filename, so it is replaced rather than letting the title and filename disagree.
  const filename = `${original.title.replace(/[\\/]/g, "-")} (web).mp4`;
  const { media } = await storeUpload(filename);
  try {
    signal?.throwIfAborted();
    await deps.linkDerivedMedia({ workspaceId: input.workspaceId, originalId: original.id, derivedId: media.id, target: "mp4-h264-aac-faststart" });
    signal?.throwIfAborted();
  } catch (error) {
    await rollbackUploadedMedia({ deps: { mediaRepo: deps.mediaRepo, blobRepo: deps.blobRepo, renditionRepo: deps.renditionRepo, clock: deps.clock }, input: { workspaceId: input.workspaceId, media } });
    throw error;
  }
  return media;
}

/**
 * Converts one stored video to a web-safe MP4 and saves it as a new media item, keeping the original.
 * @returns The original id, the new item's id and the new record.
 * @throws VideoConversionError (plain words + `ERR-` id) for an expected refusal or transcoder
 *   failure; MediaNotFoundError for an unknown id; a link-port error after removing the new item.
 * Side effects: one blob/media/rendition write and one provenance link, only after a successful,
 * un-canceled transcode. @complexity O(n) in video bytes, held in memory once plus the output.
 */
export async function convertMediaVideo(
  required: ConvertMediaVideoRequired,
  { signal, maxInputBytes = VIDEO_TRANSCODE_MAX_INPUT_BYTES, maxOutputBytes = maxInputBytes }: ConvertMediaVideoOptional = {},
): Promise<{ originalId: string; convertedId: string; media: MediaRecord }> {
  const { deps, input } = required;
  const fail = failureFactory(deps);
  throwIfCanceled({ signal, fail });
  const original = await readOriginalVideo({ deps, input, maxInputBytes, fail });
  throwIfCanceled({ signal, fail });
  const result = await deps.transcoder.transcode({ input: original.bytes, target: "mp4-h264-aac-faststart" }, { signal, maxOutputBytes });
  // An abort that lands while the transcoder finishes must still leave nothing behind.
  throwIfCanceled({ signal, fail });
  if (!result.ok) throw fail(result.reason, result.message);
  const media = await storeConvertedCopy({ deps, input, original: original.media,
    storeUpload: filename => uploadMedia({ deps, input: {
      workspaceId: input.workspaceId, bytes: result.bytes, filename, contentType: "video/mp4",
      alt: original.media.alt, caption: original.media.caption, credit: original.media.credit, createdByPrincipal: input.createdByPrincipal,
    } }, { maxUploadBytes: maxOutputBytes }),
  });
  return { originalId: original.media.id, convertedId: media.id, media };
}

export async function convertStagedMediaVideo({ deps, input, staged }: {
  deps: UploadMediaDeps & Pick<ConvertMediaVideoDeps, "linkDerivedMedia" | "randomHex"> & { transcoder: StagedMediaTranscoderPort };
  input: ConvertMediaVideoRequired["input"]; staged: StagedMediaFile;
}, { signal, maxInputBytes = VIDEO_TRANSCODE_MAX_INPUT_BYTES, maxOutputBytes = maxInputBytes }: ConvertMediaVideoOptional = {}): Promise<{ originalId: string; convertedId: string; media: MediaRecord }> {
  const fail = failureFactory(deps);
  throwIfCanceled({ signal, fail });
  const { media: original } = await findOriginalBlob({ deps, input, fail });
  if (staged.byteLength > maxInputBytes) throw fail("too-large");
  if (staged.sha256 !== original.source.sha256) throw fail("invalid");
  throwIfCanceled({ signal, fail });
  const result = await deps.transcoder.transcodeStaged({ input: staged, target: "mp4-h264-aac-faststart", consume: async output => {
    throwIfCanceled({ signal, fail });
    return storeConvertedCopy({ deps, input, original,
      storeUpload: filename => uploadStagedVideo({ deps, input: {
        workspaceId: input.workspaceId, staged: output, filename, contentType: "video/mp4",
        alt: original.alt, caption: original.caption, credit: original.credit, createdByPrincipal: input.createdByPrincipal,
      } }, { maxUploadBytes: maxOutputBytes, signal }),
    }, { signal });
  } }, { signal, maxOutputBytes });
  if (!result.ok) throw fail(result.reason, result.message);
  return { originalId: original.id, convertedId: result.value.id, media: result.value };
}
