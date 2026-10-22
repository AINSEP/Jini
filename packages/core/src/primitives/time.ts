/** Unbranded wire timestamp: hosts can share clocks without conversion adapters. */
export type ISODateTime = string;

/** Milliseconds since the Unix epoch. Zero-argument getters need no empty argument object. */
export interface Clock { nowMs(): number }

/** Default wall clock; inject a Clock to control time in application code. */
export function createSystemClock(): Clock {
  return { nowMs: () => Date.now() };
}

/** Converts epoch milliseconds using the standard UTC ISO representation. Invalid time throws. */
export function toIsoDateTime({ epochMs }: { epochMs: number }): ISODateTime {
  return new Date(epochMs).toISOString();
}

/** Samples the supplied clock once and formats its time in UTC. */
export function nowIso({ clock }: { clock: Clock }): ISODateTime {
  return toIsoDateTime({ epochMs: clock.nowMs() });
}
