import { describe, expect, it } from "vitest";

import { CONTENT_HASH_VERSION } from "../../../../publish/content/content-hash.js";
import { PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION } from "../../../../publish/transfer/index.js";
import { exportRoute, type ExportPackedEntity, type ExportRouteDeps } from "../export.js";

/** @file The export raw spec: the publishing-credential 403 before the read gate, the streamed envelope and the truncated-stream end. */

const WS = "ws-1";
const PRINCIPAL = { id: "u1" };
const HEAD = `{"artifactFormatVersion":${PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION},"hashVersion":${CONTENT_HASH_VERSION},`;

function makeDeps({ entities = [] as ExportPackedEntity[], fail = false, name = "Site" as string | null, publishing = false } = {}) {
  const seen = { pack: [] as unknown[] };
  const deps: ExportRouteDeps = {
    workspaceId: WS,
    workspaceRepo: { findById: async () => (name === null ? null : { name }) },
    isPublishingCredential: () => publishing,
    packEntities: async function* ({ principalId }) { seen.pack.push(principalId); yield* entities; if (fail) throw new Error("pack failed"); },
  };
  return { deps, seen };
}
function recordingAuthorize(denied = false) {
  const calls: unknown[] = [];
  return { calls, authorize: async (args: { permission: string; entityType?: string }) => { calls.push(args); if (denied) throw new Error("denied"); } };
}
const run = (deps: ExportRouteDeps, authorize = recordingAuthorize().authorize) =>
  exportRoute.handle({ raw: { params: { workspaceId: WS }, query: {}, body: undefined }, deps, context: PRINCIPAL, authorize }, { signal: new AbortController().signal });

describe("exportRoute", () => {
  it("pins method and path", () => {
    expect([exportRoute.method, exportRoute.path]).toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/publish-content/export"]);
  });
  it("refuses a publishing credential with its own 403 before asking for publish_content.read", async () => {
    const { deps, seen } = makeDeps({ publishing: true });
    const { calls, authorize } = recordingAuthorize();
    const refusal = await run(deps, authorize).catch((error: { response: { status: number; body: unknown } }) => error.response);
    expect(refusal).toEqual({ status: 403, body: { error: "a publishing credential cannot export from this site", code: "FORBIDDEN", details: { permission: "publish_content.read", reason: "publish_trust_export_not_wired" } } });
    expect(calls).toEqual([]);
    expect(seen.pack).toEqual([]);
  });
  it("asks publish_content.read with no entity type; a denial packs nothing", async () => {
    const { deps, seen } = makeDeps();
    const { calls, authorize } = recordingAuthorize(true);
    await expect(run(deps, authorize)).rejects.toThrow("denied");
    expect(calls).toEqual([{ permission: "publish_content.read" }]);
    expect(seen.pack).toEqual([]);
  });
  it("streams the envelope with the deduplicated blob manifest", async () => {
    const entities = [{ id: "a", requiredBlobs: ["s1", "s2"] }, { id: "b", requiredBlobs: ["s2"] }];
    const { deps, seen } = makeDeps({ entities });
    const response = await run(deps);
    expect([response.status, response.headers.get("content-type")]).toEqual([200, "application/json"]);
    const text = await response.text();
    expect(text).toBe(`${HEAD}"sourceLabel":"Site","entities":[${JSON.stringify(entities[0])},${JSON.stringify(entities[1])}],"blobManifest":["s1","s2"]}`);
    expect(seen.pack).toEqual(["u1"]);
  });
  it("labels the bundle with the workspace id when the workspace row is missing", async () => {
    const text = await (await run(makeDeps({ name: null }).deps)).text();
    expect(JSON.parse(text)).toMatchObject({ sourceLabel: WS, entities: [], blobManifest: [] });
  });
  it("ends a failed partial stream without claiming a complete JSON bundle", async () => {
    const entity = { id: "first", requiredBlobs: [] };
    const text = await (await run(makeDeps({ entities: [entity], fail: true }).deps)).text();
    expect(text).toBe(`${HEAD}"sourceLabel":"Site","entities":[${JSON.stringify(entity)}`);
    expect(() => JSON.parse(text)).toThrow(SyntaxError);
  });
});

it("cannot read a workspace or start packing without an authenticated export principal", async () => {
  const { deps, seen } = makeDeps();
  const reads: string[] = [];
  await expect(exportRoute.handle({
    raw: { params: { workspaceId: WS }, body: undefined, query: {} }, context: undefined, authorize: recordingAuthorize().authorize,
    deps: { ...deps, workspaceRepo: { findById: async () => { reads.push("workspace"); return { name: "Private" }; } } },
  }, { signal: new AbortController().signal })).rejects.toThrow(new Error("publish-content export has no authenticated principal"));
  expect(reads).toEqual([]);
  expect(seen.pack).toEqual([]);
});

it("cancelling a partially read export releases the contributor iterator", async () => {
  const { deps } = makeDeps();
  const closed: string[] = [];
  const response = await run({ ...deps, packEntities: async function* ({ principalId }) {
    try {
      yield { id: "first", requiredBlobs: [] };
      yield { id: "second", requiredBlobs: [] };
    } finally { closed.push(principalId); }
  } });
  if (!response.body) throw new Error("expected a streaming export");
  const reader = response.body.getReader();
  try {
    const opening = await reader.read();
    const entity = await reader.read();
    expect(new TextDecoder().decode(opening.value)).toBe(`${HEAD}"sourceLabel":"Site","entities":[`);
    expect(new TextDecoder().decode(entity.value)).toBe('{"id":"first","requiredBlobs":[]}');
    await reader.cancel("consumer stopped");
    expect(closed).toEqual(["u1"]);
  } finally {
    reader.releaseLock();
  }
});
