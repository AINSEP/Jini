/**
 * @file SHA-256 (FIPS 180-4) over a string's UTF-8 bytes, synchronous and dependency-free, so the
 * universal entry point needs neither `node:crypto` nor the async WebCrypto API. Used for index
 * names, where a collision-resistant digest of the full identity is required (not for secrets).
 */

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** The message padded to whole 64-byte blocks, its bit length in the last 8 bytes (big-endian). */
function pad(bytes: Uint8Array): DataView {
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(length);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(length - 4, (bytes.length * 8) >>> 0);
  return view;
}

/** One 64-byte block folded into the running state `h`. */
function compress(h: Uint32Array, view: DataView, offset: number, w: Uint32Array): void {
  for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(offset + t * 4);
  for (let t = 16; t < 64; t += 1) {
    const s0 = rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
    const s1 = rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
    w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
  }
  let [a, b, c, d, e, f, g, hh] = h as unknown as [number, number, number, number, number, number, number, number];
  for (let t = 0; t < 64; t += 1) {
    const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t]! + w[t]!) >>> 0;
    const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
    [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
  }
  [a, b, c, d, e, f, g, hh].forEach((value, index) => { h[index] = (h[index]! + value) >>> 0; });
}

/**
 * Lower-case hex SHA-256 of `required.text`'s UTF-8 encoding.
 * @complexity O(text length).
 */
export function sha256Hex(required: { readonly text: string }, _optional: Record<string, never> = {}): string {
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const view = pad(new TextEncoder().encode(required.text));
  const w = new Uint32Array(64);
  for (let offset = 0; offset < view.byteLength; offset += 64) compress(h, view, offset, w);
  return [...h].map(word => word.toString(16).padStart(8, '0')).join('');
}
