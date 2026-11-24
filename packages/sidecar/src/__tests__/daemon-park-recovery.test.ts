import { describe, expect, it } from "vitest";

import { fetchWithDaemonParkRecovery } from "../daemon-park-recovery.js";

/**
 * Moved from the host's `daemon-demand-fetch.unit.test.ts` (every assertion kept), with the header
 * names injected. Named mutation: replaying on any 503 (e.g. a reset or a generic unavailability
 * without the parked header) instead of only on an explicit park refusal turns the first test red;
 * dropping the single-retry bound (looping while parked) turns the second test red.
 */
const headers = { parked: "x-test-daemon-parked", pid: "x-test-daemon-pid" } as const;
const fail = (message: string) => { throw new Error(message); };

describe("fetchWithDaemonParkRecovery", () => {
  it("only an identified pre-dispatch park refusal can replay a request", async () => {
    const refusals: Record<string, string>[] = [{}, { [headers.parked]: "1" }, { [headers.parked]: "1", [headers.pid]: "invalid" }];
    for (const responseHeaders of refusals) {
      let sends = 0;
      const response = await fetchWithDaemonParkRecovery({
        send: async () => { sends++; return new Response(null, { status: 503, headers: responseHeaders }); },
        headers,
        ensureReady: async () => fail("generic unavailability must never replay a request"),
        onParked: () => fail("an unidentified refusal is not a park"),
      });
      expect(sends).toBe(1); expect(response.status).toBe(503);
    }
  });

  it("repeated park refusals stay bounded and refresh the endpoint after waking", async () => {
    const origins: string[] = []; let origin = "old"; let wakes = 0;
    const response = await fetchWithDaemonParkRecovery({
      send: async () => {
        origins.push(origin);
        return new Response(null, { status: 503, headers: { [headers.parked]: "1", [headers.pid]: "800" } });
      },
      headers,
      onParked: ({ pid }) => { expect(pid).toBe(800); },
      ensureReady: async () => { wakes++; origin = "new"; },
    });
    expect(response.status).toBe(503); expect(wakes).toBe(1);
    expect(origins).toEqual(["old", "new"]);
  });

  it("a park refusal on a non-503 status is not a park (a reset-like reply never replays)", async () => {
    let sends = 0;
    const response = await fetchWithDaemonParkRecovery({
      send: async () => { sends++; return new Response(null, { status: 502, headers: { [headers.parked]: "1", [headers.pid]: "800" } }); },
      headers,
      ensureReady: async () => fail("only a 503 park refusal may replay"),
      onParked: () => fail("only a 503 park refusal is a park"),
    });
    expect(sends).toBe(1); expect(response.status).toBe(502);
  });

  it("a passive observer records the park but never wakes or replays", async () => {
    let sends = 0; const parked: number[] = [];
    const response = await fetchWithDaemonParkRecovery({
      send: async () => { sends++; return new Response(null, { status: 503, headers: { [headers.parked]: "1", [headers.pid]: "42" } }); },
      headers,
      ensureReady: async () => fail("a passive observer never wakes the daemon"),
      onParked: ({ pid }) => { parked.push(pid); },
    }, { passive: true });
    expect(sends).toBe(1); expect(response.status).toBe(503); expect(parked).toEqual([42]);
  });

  it("a successful replay returns the replacement response", async () => {
    let sends = 0;
    const response = await fetchWithDaemonParkRecovery({
      send: async () => {
        sends++;
        return sends === 1
          ? new Response("parked", { status: 503, headers: { [headers.parked]: "1", [headers.pid]: "7" } })
          : new Response("ok", { status: 200 });
      },
      headers,
      ensureReady: async () => undefined,
      onParked: () => undefined,
    });
    expect(sends).toBe(2); expect(response.status).toBe(200); expect(await response.text()).toBe("ok");
  });
});
