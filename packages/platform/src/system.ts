import type { Clock, IdGenerator } from '@jini-ai/core/primitives';

/** Uses the host's cryptographic UUID generator; no insecure random fallback. */
export function createRandomUuidGenerator(): IdGenerator {
  return { newId: () => globalThis.crypto.randomUUID() };
}

/** Default wall clock; inject a Clock to control time in application code. */
export function createSystemClock(): Clock {
  return { nowMs: () => Date.now() };
}
