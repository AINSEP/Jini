/**
 * @file The `@jini-ai/cms/media/node` entry: the Node-bound adapters a host wires in, re-exported
 * from their owning modules (same bindings, so `instanceof` and identity checks agree across entries).
 */
import { expect, test } from "vitest";
import * as nodeEntry from "../node.js";
import { LocalFsBlobStore } from "../blob-store.fs.js";
import { ImageSourceCorruptError, ImageTransformUnavailableError, SharpImageTransformer } from "../image-transformer.sharp.js";
import { createFfmpegVideoFrameExtractor, createVideoExtractionLock, findVideoBinaries, runLowPriorityVideoProcess } from "../video-frames.ffmpeg.js";

test("the media/node entry exposes exactly the Node-bound adapters, as the owning modules' own bindings", () => {
  const owned = {
    LocalFsBlobStore, SharpImageTransformer, ImageTransformUnavailableError, ImageSourceCorruptError,
    createFfmpegVideoFrameExtractor, createVideoExtractionLock, findVideoBinaries, runLowPriorityVideoProcess,
  };
  expect(Object.keys(nodeEntry).sort()).toEqual(Object.keys(owned).sort());
  for (const [name, binding] of Object.entries(owned)) expect(nodeEntry[name as keyof typeof owned], name).toBe(binding);
});
