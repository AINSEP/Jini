/**
 * @file Converts a `Uint8Array` to the `ArrayBuffer` E2B's `files.write` actually accepts.
 *
 * Purpose:
 * E2B's real `write` signature is `string | ArrayBuffer | Blob | ReadableStream` — no
 * `Uint8Array` overload, even though `SandboxFile.content` in `./core` is `string | Uint8Array`
 * specifically because it's what Node and the browser share natively. A naive `.buffer` access
 * is wrong the moment the `Uint8Array` is a *view* over a larger buffer (e.g. produced by
 * `.subarray()`) rather than owning the whole thing — it would silently include bytes outside
 * the view's range, corrupting the write in a different way than the one this type was widened
 * to prevent.
 */

/** Returns a fresh `ArrayBuffer` containing exactly `bytes`' own range — safe even when `bytes`
 *  is a view with a non-zero `byteOffset` over a larger, shared `buffer`. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
