export interface Token<T, Id extends string = string> {
  readonly id: Id;
  readonly version: number;
  readonly cardinality: 'one';
  /** Phantom — never assigned; carries T for inference only. */
  readonly __type?: T;
}

export interface ManyToken<T, Id extends string = string> {
  readonly id: Id;
  readonly version: number;
  readonly cardinality: 'many';
  /** Phantom — never assigned; carries T for inference only. */
  readonly __type?: T;
}

export type AnyToken<T = unknown, Id extends string = string> = Token<T, Id> | ManyToken<T, Id>;

export function token<T, const Id extends string = string>({ id }: { id: Id }, opts: { version?: number } = {}): Token<T, Id> {
  return { id, version: opts.version ?? 1, cardinality: 'one' };
}

export function manyToken<T, const Id extends string = string>(
  { id }: { id: Id },
  opts: { version?: number } = {},
): ManyToken<T, Id> {
  return { id, version: opts.version ?? 1, cardinality: 'many' };
}

/** Native constant-time byte comparison supplied by the host (for example node:crypto).
 * The host must provide a timing-safe implementation; ordinary byte/string equality is unsafe. */
export type TimingSafeByteComparison = (required: { left: Uint8Array; right: Uint8Array }) => boolean;

/**
 * Constant-time token comparison after UTF-8 encoding. Length is compared first and NOT in
 * constant time — that leaks only the expected token's length, which for a generated secret is
 * fixed and not itself a secret, never any of its bytes. Native timingSafeEqual throws on a
 * length mismatch, so the early return is required rather than merely an optimization.
 *
 * A plain string compare short-circuits on the first differing byte, making its duration a
 * function of the matching prefix — enough, over many requests, to recover a token byte by byte.
 * The injected native comparison preserves that security boundary without making the universal
 * kernel import Node. UTF-8 replacement of lone surrogates matches Buffer.from(text, 'utf8').
 * O(n) encoding work and space, followed by the host's constant-time equal-length comparison.
 */
export function timingSafeTokenMatch({ presented, expected, timingSafeEqual }: {
  readonly presented: string;
  readonly expected: string;
  readonly timingSafeEqual: TimingSafeByteComparison;
}, _optional: Record<string, never> = {}): boolean {
  const encoder = new TextEncoder();
  const presentedBytes = encoder.encode(presented);
  const expectedBytes = encoder.encode(expected);
  if (presentedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual({ left: presentedBytes, right: expectedBytes });
}
