import { describe, expect, it } from "vitest";
import { healthRoute, healthzRoute } from "../health.js";

/** @file The public liveness probes: no deps, no principal, no authorization, one constant answer. */

const signal = new AbortController().signal;
/** A liveness probe never authorizes; this one makes any call fail the test loudly. */
const noAuthorize = async () => { throw new Error("liveness probe must not authorize"); };
/** Whatever a caller sends, the probe ignores it (it is mounted before any body parser). */
const noisy = { params: { any: "x" }, query: { verbose: "1" }, body: { ignored: true } };

describe.each([
  ["healthRoute", healthRoute, "/health"],
  ["healthzRoute", healthzRoute, "/healthz"],
] as const)("%s", (_name, route, path) => {
  it("keeps GET on its root-level path, the default 200, no body cap and no same-origin gate", () => {
    expect(route.method).toBe("get");
    expect(route.path).toBe(path);
    expect(route.successStatus).toBeUndefined();
    expect(route.maxBodyBytes).toBeUndefined();
    expect(route.requireSameOrigin).toBeUndefined();
  });

  it("parses every request to an empty input, ignoring params, query and body", () => {
    expect(route.parse({ params: {}, query: {}, body: undefined })).toEqual({ ok: true, value: {} });
    expect(route.parse(noisy)).toEqual({ ok: true, value: {} });
  });

  it("answers { ok: true } without a principal and without authorizing", async () => {
    const result = await route.handle({ input: {}, deps: {}, context: undefined, authorize: noAuthorize }, { signal });
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });
});
