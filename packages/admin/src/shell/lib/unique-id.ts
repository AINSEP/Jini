/**
 * @file Client-minted ids that only need to be unique — placement ids, run ids, idempotency keys.
 * None of them is a secret or gates access. A leaf module with no imports, so any module can use it
 * without an import cycle.
 */

let fallbackSequence = 0;

/** `crypto.randomUUID()` where the browser offers it (secure contexts only), else `<ms>-<suffix>`:
 *  64 random bits from `crypto.getRandomValues` (offered in insecure contexts too) or, with no Web
 *  Crypto at all, a per-page sequence number that keeps ids from colliding within this page. */
export function uniqueId(): string {
  const webCrypto: Partial<Crypto> | undefined = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();
  return `${Date.now()}-${fallbackSuffix({ webCrypto })}`;
}

function fallbackSuffix({ webCrypto }: { webCrypto: Partial<Crypto> | undefined }, _options = {}): string {
  if (typeof webCrypto?.getRandomValues === "function") {
    const words = webCrypto.getRandomValues(new Uint32Array(2));
    const [first, second] = words;
    if (first === undefined || second === undefined) throw new Error("unique id random source returned fewer than two values");
    // Fixed-width words: unpadded, (1, 36) and (37, 0) both concatenate to "110".
    return toFixedBase36(first) + toFixedBase36(second);
  }
  fallbackSequence += 1;
  return fallbackSequence.toString(36);
}

/** A 32-bit word in base 36, zero-padded to the 7 digits `0xffffffff` needs ("1z141z3"). */
function toFixedBase36(word: number): string {
  return word.toString(36).padStart(7, "0");
}
