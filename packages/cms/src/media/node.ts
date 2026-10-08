/** Node-bound media adapters; hosts supply the filesystem and optional codecs. */
export { LocalFsBlobStore, type LocalFsBlobStoreDeps } from "./blob-store.fs.js";

export { SharpImageTransformer, ImageTransformUnavailableError, ImageSourceCorruptError } from "./image-transformer.sharp.js";

// Video previews: policy/port plus a bounded optional-host codec adapter.
export {
  createFfmpegVideoFrameExtractor, findVideoBinaries, runLowPriorityVideoProcess,
  type VideoBinaries, type VideoBinaryFinder, type VideoProcessRunner,
} from './video-frames.ffmpeg.js';
