/** Shared host-shaped doubles for the live-url suites: reserved segments, egress refusal, peer rule. */
import type { LiveEgressRefusal, LiveOriginPolicy, LivePeerRow } from "../live-url.js";

/** The reserved first segments a typical host passes (its admin and API surfaces). */
export const reservedSegments: ReadonlySet<string> = new Set(["admin", "api"]);

class FakeEgressRefusal extends Error {
  constructor(readonly callerSafeMessage: string) { super("internal: " + callerSafeMessage); }
}
export function egressRefusal({ callerSafeMessage }: { callerSafeMessage: string }, _optional = {}): Error { return new FakeEgressRefusal(callerSafeMessage); }
export const isEgressRefusal: LiveEgressRefusal = (error): error is FakeEgressRefusal => error instanceof FakeEgressRefusal;

type DatedRow = LivePeerRow & { updatedAt?: string };
/** A host-like rule: the most recently updated unkeyed row is the connected destination. */
export const selectConnectedDestination: LiveOriginPolicy["selectConnectedDestination"] = ({ rows }) => {
  let chosen: DatedRow | null = null;
  for (const row of rows as readonly DatedRow[]) {
    if (row.sealed !== null) continue;
    if (chosen === null || (row.updatedAt ?? "") > (chosen.updatedAt ?? "")) chosen = row;
  }
  return chosen;
};
