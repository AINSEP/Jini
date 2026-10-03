/** Unbranded identifier; UUID-producing adapters and opaque host IDs share this port. */
export type UUID = string;

export interface IdGenerator { newId(): string }

/** Uses the host's cryptographic UUID generator; no insecure random fallback. */
export function createRandomUuidGenerator(): IdGenerator {
  return { newId: () => globalThis.crypto.randomUUID() };
}
