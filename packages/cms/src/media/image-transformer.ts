/**
 * @file `ImageTransformerPort` (port/adapter rule-of-two) — the seam between
 * rendition generation (`rendition-service.ts`) and the actual pixel
 * operation. Two adapters:
 *  - `InMemoryImageTransformer` (this file) — deterministic test double, no
 *    real image codec. Default for hermetic tests and a dev/test composition
 *    root, mirroring `InMemoryBlobStore`'s role next to `LocalFsBlobStore`.
 *  - `SharpImageTransformer` (`image-transformer.sharp.ts`) — the real
 *    adapter, wired to call `sharp`. See that file's header: `sharp` is an
 *    optional runtime dependency, loaded lazily, not a hard import.
 */
import type { TransformParams } from "./transform-types.js";
import { mimeForTransformFormat } from "./transform-types.js";

export interface TransformImageInput {
  bytes: Uint8Array;
  params: TransformParams;
}

export interface TransformImageOutput {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Runs one named transform's declared parameters against source bytes,
 * producing re-encoded output bytes ("renditions are always
 * re-encoded"). Implementations are expected to be pure with respect to
 * `input` (same bytes + same params -> same output), which is what makes the
 * content-addressed rendition storage key (`rendition-service.ts`) sound.
 */
export interface ImageTransformerPort {
  transform(input: TransformImageInput): Promise<TransformImageOutput>;
}

/**
 * Deterministic test double. NOT a real image codec — it does not resize or
 * re-encode pixels. It prefixes the source bytes with a small tag describing
 * the applied `params` so tests can assert that (a) different params yield
 * different, reproducible output bytes and (b) the same params yield the
 * same output bytes twice (idempotent, single-flight-safe). Production code
 * must use `SharpImageTransformer` instead — see that file's header.
 *
 * @complexity O(n) in input byte length (one concat).
 * @overallScore 100
 */
export class InMemoryImageTransformer implements ImageTransformerPort {
  async transform(input: TransformImageInput): Promise<TransformImageOutput> {
    const tag = `TEST_TRANSFORM:${JSON.stringify(input.params)}:`;
    const tagBytes = new TextEncoder().encode(tag);
    const output = new Uint8Array(tagBytes.length + input.bytes.length);
    output.set(tagBytes, 0);
    output.set(input.bytes, tagBytes.length);
    return { bytes: output, contentType: mimeForTransformFormat(input.params.format) };
  }
}
