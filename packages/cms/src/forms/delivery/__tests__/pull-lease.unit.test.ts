/**
 * @file Unit tests for pull admission: which recent-start window each trigger asks for, that a
 * refused claim never pulls, and that the lease is always released by the token that took it.
 */
import { describe, expect, test } from "vitest";
import { FORM_PULL_RECENT_MS, withFormPullLease, type FormPullClaim, type FormPullLeasePort } from "../index.js";

type ClaimInput = Parameters<FormPullLeasePort["claim"]>[0];
type ReleaseInput = Parameters<FormPullLeasePort["release"]>[0];

/** Typed recording fake; answers every claim with `answer`. */
class RecordingLeases implements FormPullLeasePort {
  readonly claims: ClaimInput[] = [];
  readonly releases: ReleaseInput[] = [];
  constructor(private readonly answer: FormPullClaim = { claimed: true }) {}
  async claim(required: ClaimInput): Promise<FormPullClaim> { this.claims.push(required); return this.answer; }
  async release(required: ReleaseInput): Promise<void> { this.releases.push(required); }
}

const base = { workspaceId: "w-1", receiverKey: "receiver-a", token: "tok-1", nowIso: "2026-10-20T12:00:00.000Z", leaseMs: 375_000 };

describe("claim window", () => {
  test("the automatic debounce is sixty seconds", () => {
    expect(FORM_PULL_RECENT_MS).toBe(60_000);
  });

  test("an automatic pull claims with the recent-start window and the host lease length", async () => {
    const leases = new RecordingLeases();
    await withFormPullLease({ ...base, leases, trigger: "automatic", pull: async () => 1 });
    expect(leases.claims).toEqual([{ ...base, recentMs: FORM_PULL_RECENT_MS }]);
  });

  test("a manual pull bypasses the recent-start window", async () => {
    const leases = new RecordingLeases();
    await withFormPullLease({ ...base, leases, trigger: "manual", pull: async () => 1 });
    expect(leases.claims[0]!.recentMs).toBe(0);
  });
});

describe("refused claim", () => {
  test.each(["already-running", "recent"] as const)("%s returns the reason without pulling or releasing", async reason => {
    const leases = new RecordingLeases({ claimed: false, reason });
    let pulls = 0;
    const result = await withFormPullLease({ ...base, leases, trigger: "manual", pull: async () => { pulls++; } });
    expect(result).toEqual({ ran: false, reason });
    expect(pulls).toBe(0);
    expect(leases.releases).toEqual([]);
  });
});

describe("claimed", () => {
  test("returns the pull's result and releases with the same token", async () => {
    const leases = new RecordingLeases();
    const result = await withFormPullLease({ ...base, leases, trigger: "automatic", pull: async () => ({ imported: 3 }) });
    expect(result).toEqual({ ran: true, result: { imported: 3 } });
    expect(leases.releases).toEqual([{ workspaceId: "w-1", receiverKey: "receiver-a", token: "tok-1" }]);
  });

  test("the lease is still held while the pull runs and released only after it settles", async () => {
    const leases = new RecordingLeases();
    let releasesDuringPull = -1;
    await withFormPullLease({ ...base, leases, trigger: "automatic", pull: async () => { releasesDuringPull = leases.releases.length; } });
    expect([releasesDuringPull, leases.releases.length]).toEqual([0, 1]);
  });

  test("a failing pull rethrows its error after releasing the lease", async () => {
    const leases = new RecordingLeases();
    const failure = new Error("receiver returned 502");
    await expect(withFormPullLease({ ...base, leases, trigger: "manual", pull: async () => { throw failure; } })).rejects.toBe(failure);
    expect(leases.releases).toHaveLength(1);
  });
});
