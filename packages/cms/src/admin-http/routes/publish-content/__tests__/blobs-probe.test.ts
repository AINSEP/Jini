import { describe, expect, it } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { PUBLISH_CONTENT_BLOB_PROBE_MAX_SHAS } from "../../../../publish/transfer/blob-staging.js";
import { blobsProbeRoute, type BlobsProbeRouteDeps } from "../blobs-probe.js";
import { WORKSPACE_ID } from "./transport-helpers.js";

/** @file The blobs-probe spec: the `publish_content.apply` gate, the flat 400 bodies and the missing-sha answer. */

const sha = (digit: string): string => digit.repeat(64);

function makeDeps(present: readonly string[]) {
  const asked: string[] = [];
  const deps: BlobsProbeRouteDeps = {
    workspaceId: WORKSPACE_ID,
    blobStore: { exists: async ({ storageKey }) => { asked.push(storageKey); return present.some((hit) => storageKey.endsWith(hit)); } },
  };
  return { deps, asked };
}

async function run({ body, deps, denied = false }: { body: unknown; deps: BlobsProbeRouteDeps; denied?: boolean }) {
  const calls: unknown[] = [];
  const authorize = async (args: unknown) => { calls.push(args); if (denied) throw new Error("denied"); };
  const parsed = blobsProbeRoute.parse({ body, query: {}, params: { workspaceId: WORKSPACE_ID } });
  if (!parsed.ok) throw new Error("parse refused");
  return { outcome: await (async () => blobsProbeRoute.handle({ input: parsed.value, deps, context: { id: "u1" }, authorize }))().then((result) => ({ result }), (error: unknown) => ({ error })), calls };
}

const refusalOf = (outcome: { error?: unknown }): { status: number; body: unknown } => {
  if (!(outcome.error instanceof RouteRefusalError)) throw new Error("expected a refusal");
  return outcome.error.response;
};

describe("blobsProbeRoute", () => {
  // No spec cap on purpose: the host mounts the content-entry cap as a body-parser slot middleware (its own
  // 413 body, ahead of the workspace refusal); a spec `maxBodyBytes` too would measure the body twice.
  it("pins method, path, no spec body cap and the 200 default", () => {
    expect([blobsProbeRoute.method, blobsProbeRoute.path, blobsProbeRoute.maxBodyBytes, blobsProbeRoute.successStatus])
      .toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/publish-content/blobs/probe", undefined, undefined]);
  });

  it("authorizes publish_content.apply first and answers the shas the store does not hold, in request order", async () => {
    const { deps, asked } = makeDeps([sha("b")]);
    const { outcome, calls } = await run({ body: { shas: [sha("a"), sha("b"), sha("c")] }, deps });
    expect(calls).toEqual([{ permission: "publish_content.apply" }]);
    expect(outcome).toEqual({ result: { ok: true, value: { missing: [sha("a"), sha("c")] } } });
    expect(asked).toEqual([sha("a"), sha("b"), sha("c")].map((digit) => `ws/${WORKSPACE_ID}/blobs/${digit.slice(0, 2)}/${digit}`));
  });

  it("a denial stops before any store read", async () => {
    const { deps, asked } = makeDeps([]);
    const { outcome } = await run({ body: { shas: [sha("a")] }, deps, denied: true });
    expect(outcome).toHaveProperty("error");
    expect(asked).toEqual([]);
  });

  it.each([
    ["no body", undefined, "shas must be a non-empty array of sha256 hex digests"],
    ["an empty list", { shas: [] }, "shas must be a non-empty array of sha256 hex digests"],
    ["a non-array", { shas: "x" }, "shas must be a non-empty array of sha256 hex digests"],
    ["too many", { shas: Array.from({ length: PUBLISH_CONTENT_BLOB_PROBE_MAX_SHAS + 1 }, () => sha("a")) }, `at most ${PUBLISH_CONTENT_BLOB_PROBE_MAX_SHAS} shas are allowed per request`],
    ["a bad digest", { shas: [sha("a"), "ABC"] }, "'ABC' is not a valid lowercase sha256 hex digest"],
    ["a non-string", { shas: [7] }, "'7' is not a valid lowercase sha256 hex digest"],
  ])("refuses %s with the flat 400 body {error} and no code, after authorization", async (_name, body, error) => {
    const { deps, asked } = makeDeps([]);
    const { outcome, calls } = await run({ body, deps });
    expect(refusalOf(outcome as { error?: unknown })).toEqual({ status: 400, body: { error } });
    expect(calls).toHaveLength(1);
    expect(asked).toEqual([]);
  });
});
