/** Bounded asynchronous collision search; naming and copy wording are required host policy. */
export const MAX_SUFFIX_ATTEMPTS = 1000;
// A generous finite bound prevents a pathological namespace or broken predicate from spinning forever.

export interface NamingPolicy {
  isTaken: (required: { candidate: string }) => Promise<boolean>;
  withSuffix: (required: { base: string; suffix: number }) => string;
  exhaustionMessage: (required: { base: string; maxAttempts: number }) => string;
}

export interface AvailableNameOptions {
  maxAttempts?: number;
  onExhausted?: (required: { base: string; maxAttempts: number }) => never;
}

/** O(k) sequential predicate calls, O(1) local space, k <= maxAttempts. */
export async function deriveAvailableName(
  required: NamingPolicy & { base: string },
  optional: AvailableNameOptions = {},
): Promise<string> {
  // isTaken may also reject reserved/invalid candidates. withSuffix owns formatting and length caps;
  // shorten the base to make room rather than truncating the counter and repeating a taken candidate.
  const maxAttempts = optional.maxAttempts ?? MAX_SUFFIX_ATTEMPTS;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('maxAttempts must be a positive safe integer');
  for (let suffix = 1; suffix <= maxAttempts; suffix += 1) {
    const candidate = suffix === 1 ? required.base : required.withSuffix({ base: required.base, suffix });
    if (!(await required.isTaken({ candidate }))) return candidate;
  }
  if (optional.onExhausted) optional.onExhausted({ base: required.base, maxAttempts });
  throw new Error(required.exhaustionMessage({ base: required.base, maxAttempts }));
}

const TRAILING_NUMBER_PATTERN = /^(.*\S) \d+$/;
// Require a non-space base: a bare number has nothing meaningful to strip. Existing-base evidence
// distinguishes a copy counter ("Landing 2") from a real title ("Blog 2024" with no "Blog" row).

/** O(k) plus at most one base lookup. A trailing integer is a counter only if its base exists. */
export async function deriveDuplicateName(
  required: NamingPolicy & { sourceName: string },
  optional: AvailableNameOptions = {},
): Promise<string> {
  const strippedBase = TRAILING_NUMBER_PATTERN.exec(required.sourceName)?.[1];
  const base = strippedBase !== undefined && await required.isTaken({ candidate: strippedBase })
    ? strippedBase : required.sourceName;
  return deriveAvailableName({
    // A copy must never reuse the source's name, even if the external predicate overlooks its row.
    ...required, base,
    isTaken: ({ candidate }) => candidate === required.sourceName ? Promise.resolve(true) : required.isTaken({ candidate }),
  }, optional);
}
