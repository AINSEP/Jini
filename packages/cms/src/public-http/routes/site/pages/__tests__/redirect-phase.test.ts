import { describe, expect, it } from "vitest";
import { tryRedirectPhase, type RedirectPhaseRouting } from "../redirect-phase.js";

/** @file `tryRedirectPhase`: which phase runner it consults, and that only a redirect outcome writes. */

type Outcome = Awaited<ReturnType<RedirectPhaseRouting["runPreContentPhase"]>>;

/** Records every phase call and every redirect write. */
function harness(outcome: Outcome) {
  const calls: string[] = [];
  const redirects: Array<[number, string]> = [];
  const routing: RedirectPhaseRouting = {
    runPreContentPhase: async ({ path, ctx }) => { calls.push(`pre:${path}:${ctx.workspaceId}`); return outcome; },
    runPostContentPhase: async ({ path, ctx }) => { calls.push(`post:${path}:${ctx.workspaceId}`); return outcome; },
  };
  const res = { redirect: (statusCode: number, location: string) => { redirects.push([statusCode, location]); } };
  return { calls, redirects, routing, res };
}

describe("tryRedirectPhase", () => {
  it("issues the matched redirect from the pre_content phase and reports it", async () => {
    const h = harness({ kind: "redirect", statusCode: 301, location: "/new" } as Outcome);
    await expect(tryRedirectPhase({ phase: "pre_content", path: "/old", workspaceId: "w1", res: h.res, routing: h.routing })).resolves.toBe(true);
    expect(h.calls).toEqual(["pre:/old:w1"]);
    expect(h.redirects).toEqual([[301, "/new"]]);
  });

  it("consults only the post_content runner for the post phase", async () => {
    const h = harness({ kind: "redirect", statusCode: 302, location: "/later" } as Outcome);
    await expect(tryRedirectPhase({ phase: "post_content", path: "/gone", workspaceId: "w2", res: h.res, routing: h.routing })).resolves.toBe(true);
    expect(h.calls).toEqual(["post:/gone:w2"]);
    expect(h.redirects).toEqual([[302, "/later"]]);
  });

  it("falls through without writing when no phase matched", async () => {
    const h = harness(null);
    await expect(tryRedirectPhase({ phase: "pre_content", path: "/x", workspaceId: "w1", res: h.res, routing: h.routing })).resolves.toBe(false);
    expect(h.redirects).toEqual([]);
  });
});
