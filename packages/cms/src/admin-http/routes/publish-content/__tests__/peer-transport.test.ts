import { describe, expect, it, vi } from "vitest";

import type { PeerCallDeps } from "../../../../publish/content/peer-transport.js";
import { peerPushPlanRoute, peerPushConfirmRoute, peerPushExecuteRoute, peerPullRoute, acceptOverwriteEntityKeys, createPeerCallResolver, OVERWRITE_REFUSED, type PeerActionRefusalFn } from "../peer-transport.js";
import { raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./transport-helpers.js";

const PULL = "/api/admin/v1/workspaces/:workspaceId/publish-content/peers/:peerId/pull";

class PeerTransportError extends Error {}

/** The host's peer-action mapping: a transport failure is a 502, anything else unmapped. */
const peerActionRefusal: PeerActionRefusalFn = ({ error }) =>
  error instanceof PeerTransportError ? { status: 502, body: { error: error.message, code: "PEER_UNREACHABLE" } } : undefined;

/** Deps with a recording `pullAndStage`; `fail` makes it throw. */
function makeDeps(fail?: Error) {
  const calls: unknown[] = [];
  return {
    calls,
    deps: {
      workspaceId: WORKSPACE_ID, peerActionRefusal,
      pullAndStage: async (input: { peerId: string; principalId: string }) => {
        calls.push(input);
        if (fail) throw fail;
        return { bundleId: "b1", entityCount: 3 };
      },
    },
  };
}

describe("peerPullRoute", () => {
  it("is POST .../peers/:peerId/pull answering 201", () => {
    expect([peerPullRoute.method, peerPullRoute.path, peerPullRoute.successStatus, peerPullRoute.maxBodyBytes]).toEqual(["post", PULL, 201, undefined]);
  });

  it("parses only the peer id, refusing nothing (the authorizer answers first)", () => {
    expect(peerPullRoute.parse(raw({ peerId: "p1" }, { ignored: true }))).toStrictEqual({ ok: true, value: { peerId: "p1" } });
    expect(peerPullRoute.parse(raw({}))).toStrictEqual({ ok: true, value: { peerId: "" } });
  });

  it("asks publish_content.apply, then stages the peer's export for this principal", async () => {
    const { calls, deps } = makeDeps();
    const { calls: asked, authorize } = recordingAuthorize();
    const result = await peerPullRoute.handle({ input: { peerId: "p1" }, deps, context: { id: "u1" }, authorize } as never);
    expect(asked).toEqual([{ permission: "publish_content.apply", entityType: "publish-content-peer" }]);
    expect(calls).toEqual([{ peerId: "p1", principalId: "u1" }]);
    expect(result).toEqual({ ok: true, value: { bundleId: "b1", entityCount: 3 } });
  });

  it("stages nothing when the authorizer refuses", async () => {
    const { calls, deps } = makeDeps();
    const { authorize } = recordingAuthorize(["publish_content.apply"]);
    await expect(peerPullRoute.handle({ input: { peerId: "p1" }, deps, context: { id: "u1" }, authorize } as never)).rejects.toThrow("denied publish_content.apply");
    expect(calls).toEqual([]);
  });

  it("answers a host-mapped peer failure with the host's refusal", async () => {
    const { deps } = makeDeps(new PeerTransportError("the peer did not answer"));
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => peerPullRoute.handle({ input: { peerId: "p1" }, deps, context: { id: "u1" }, authorize } as never)))
      .toEqual({ status: 502, body: { error: "the peer did not answer", code: "PEER_UNREACHABLE" } });
  });

  it("rethrows an unmapped failure unchanged for the mount's redacted 500", async () => {
    const boom = new Error("driver exploded");
    const { deps } = makeDeps(boom);
    const { authorize } = recordingAuthorize();
    await expect(peerPullRoute.handle({ input: { peerId: "p1" }, deps, context: { id: "u1" }, authorize } as never)).rejects.toBe(boom);
  });

  it("fails closed without a principal or an authorizer", async () => {
    const { calls, deps } = makeDeps();
    const { authorize } = recordingAuthorize();
    await expect(peerPullRoute.handle({ input: { peerId: "p1" }, deps, context: undefined, authorize } as never)).rejects.toThrow("no authenticated principal");
    await expect(peerPullRoute.handle({ input: { peerId: "p1" }, deps, context: { id: "u1" }, authorize: undefined } as never)).rejects.toThrow("no authorizer");
    expect(calls).toEqual([]);
  });
});

it("malformed scope and non-session overwrite are refused before opening a peer, while an empty selection is forwarded", async () => {
  const calls: unknown[] = [];
  const peer = {} as PeerCallDeps<string>;
  const deps = { openPeer: async (input: { peerId: string }) => { calls.push(input); return peer; }, requireOverwriteSession: () => { throw new Error("session"); }, plan: async (input: unknown) => { calls.push(input); return { remote: true }; } };
  const authorize = async (input: unknown) => { calls.push(input); };
  expect(await peerPushPlanRoute.handle({ input: { peerId: "p", body: { scope: {} } }, deps, context: { id: "u" }, authorize })).toMatchObject({ value: { status: 400 } });
  expect(calls).toEqual([{ permission: "publish_content.apply" }]); calls.length = 0;
  await expect(peerPushPlanRoute.handle({ input: { peerId: "p", body: { overwriteEntityKeys: ["post:p"] } }, deps, context: { id: "u" }, authorize })).rejects.toThrow("session");
  expect(calls).toEqual([{ permission: "publish_content.apply" }]); calls.length = 0;
  expect(await peerPushPlanRoute.handle({ input: { peerId: "p", body: { selectedEntityKeys: [] } }, deps, context: { id: "u" }, authorize })).toEqual({ ok: true, value: { remote: true } });
  expect(calls).toEqual([{ permission: "publish_content.apply" }, { peerId: "p" }, { peer, principalId: "u", scope: null, selectedEntityKeys: [], overwriteEntityKeys: null }]);
});

it("keeps confirm and execute payloads distinct and forwards remote refusals unchanged", async () => {
  const calls: unknown[] = [];
  const peer = {} as PeerCallDeps<string>;
  const openPeer = async () => peer;
  const confirm = async (input: unknown) => { calls.push(["confirm", input]); return { refused: true }; };
  const execute = async (input: unknown) => { calls.push(["execute", input]); return { refused: true }; };
  const authorize = async () => {};
  const context = { id: "u" };
  expect(await peerPushConfirmRoute.handle({ input: { peerId: "p", body: { planId: "plan", planHash: "hash" } }, deps: { openPeer, confirm }, authorize, context })).toEqual({ ok: true, value: { refused: true } });
  expect(await peerPushExecuteRoute.handle({ input: { peerId: "p", body: { bundleId: "b", confirmationToken: "t", overwriteEntityKeys: [] } }, deps: { openPeer, execute, requireOverwriteSession: () => { throw new Error("must not call"); } }, authorize, context })).toEqual({ ok: true, value: { refused: true } });
  expect(calls).toEqual([["confirm", { peer, planId: "plan", planHash: "hash" }], ["execute", { peer, bundleId: "b", confirmationToken: "t", overwriteEntityKeys: [] }]]);
});

function scopedPlanFixture() {
  const credential = { id: "live-3", label: "Live", baseUrl: "https://live.example.test", apiKey: "test-key", remoteWorkspaceId: "remote" };
  const peer: PeerCallDeps<string> = { credential, httpClient: { send: async () => { throw new Error("unexpected peer I/O"); } } };
  const openPeer = vi.fn(async () => peer);
  const requireOverwriteSession = vi.fn();
  const plan = vi.fn(async () => ({ updates: 2 }));
  const run = (body: unknown) => peerPushPlanRoute.handle({
    input: { peerId: "live-3", body }, context: { id: "owner-7" }, authorize: async () => {},
    deps: { openPeer, requireOverwriteSession, plan },
  });
  return { peer, run, openPeer, requireOverwriteSession, plan };
}

it.each([
  { name: "array scope", body: { scope: [] }, message: "'scope' must be an object with 'entityTypes' and/or 'entityKeys'" },
  { name: "scalar scope", body: { scope: "post" }, message: "'scope' must be an object with 'entityTypes' and/or 'entityKeys'" },
  { name: "empty entity types", body: { scope: { entityTypes: [] } }, message: "'scope.entityTypes' must be a non-empty array of strings" },
  { name: "non-array entity types", body: { scope: { entityTypes: "post" } }, message: "'scope.entityTypes' must be a non-empty array of strings" },
  { name: "too many entity keys", body: { scope: { entityTypes: ["post"], entityKeys: Array.from({ length: 1_001 }, (_, index) => `post:${index}`) } }, message: "'scope.entityKeys' must be a non-empty array of strings" },
  { name: "invalid entity key between valid ones", body: { scope: { entityKeys: ["post:1", 7, "post:3"] } }, message: "'scope.entityKeys' must be a non-empty array of strings" },
  { name: "non-string selected key", body: { selectedEntityKeys: ["post:1", 7, "post:3"] }, message: "'selectedEntityKeys' must be an array of strings" },
  { name: "scalar selected keys", body: { selectedEntityKeys: "post:1" }, message: "'selectedEntityKeys' must be an array of strings" },
])("rejects $name before opening a peer", async ({ body, message }) => {
  const { run, openPeer, requireOverwriteSession, plan } = scopedPlanFixture();
  expect(await run(body)).toStrictEqual({ ok: true, value: {
    status: 400, body: { error: message, code: "VALIDATION_ERROR" },
  } });
  expect(openPeer).not.toHaveBeenCalled();
  expect(requireOverwriteSession).not.toHaveBeenCalled();
  expect(plan).not.toHaveBeenCalled();
});

it("forwards scoped keys at the limit, independently of row selection and overwrite", async () => {
  const { run, peer, openPeer, plan } = scopedPlanFixture();
  const entityKeys = Array.from({ length: 1_000 }, (_, index) => `post:${index}`);
  expect(await run({ scope: { entityKeys }, selectedEntityKeys: ["post:9"], overwriteEntityKeys: ["post:9"] }))
    .toStrictEqual({ ok: true, value: { updates: 2 } });
  expect(openPeer.mock.calls).toEqual([[{ peerId: "live-3" }]]);
  expect(plan.mock.calls).toEqual([[{ peer, principalId: "owner-7", scope: { entityKeys },
    selectedEntityKeys: ["post:9"], overwriteEntityKeys: ["post:9"],
  }]]);
});

it("the overwrite adapter distinguishes malformed input from an authorization refusal and a successful empty selection", () => {
  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })) };
  const mayOverwrite = vi.fn<Parameters<typeof acceptOverwriteEntityKeys>[0]["mayOverwrite"]>()
    .mockImplementation(({ res, overwriteEntityKeys }) => {
      if (overwriteEntityKeys?.length) {
        res.status(403).json({ error: "Need a session", code: "OVERWRITE_DENIED" });
        return false;
      }
      return true;
    });
  expect(acceptOverwriteEntityKeys({ res, raw: ["post:1", 2], mayOverwrite })).toBe(OVERWRITE_REFUSED);
  expect(mayOverwrite).not.toHaveBeenCalled();
  expect(acceptOverwriteEntityKeys({ res, raw: ["post:1"], mayOverwrite })).toBe(OVERWRITE_REFUSED);
  expect(acceptOverwriteEntityKeys({ res, raw: [], mayOverwrite })).toEqual([]);
  expect(acceptOverwriteEntityKeys({ res, raw: undefined, mayOverwrite })).toBeNull();
  expect(res.status.mock.calls).toEqual([[400], [403]]);
  expect(json.mock.calls).toEqual([
    [{ error: "'overwriteEntityKeys' must be an array of strings", code: "VALIDATION_ERROR" }],
    [{ error: "Need a session", code: "OVERWRITE_DENIED" }],
  ]);
  expect(mayOverwrite.mock.calls).toEqual([
    [{ res, overwriteEntityKeys: ["post:1"] }], [{ res, overwriteEntityKeys: [] }], [{ res, overwriteEntityKeys: null }],
  ]);
});

it("opens each peer credential in the local workspace and uses that scope for publish history", async () => {
  const credential = { id: "remote-7", label: "Live", baseUrl: "https://live.example.test", apiKey: "test-key",
    remoteWorkspaceId: "overseas" };
  const resolveCredential = vi.fn(async () => credential);
  const store = { recordSuccess: vi.fn(async () => {}) };
  const clock = { nowMs: () => 47_000 };
  const httpClient = { send: vi.fn(async () => { throw new Error("unexpected peer I/O"); }) };
  const resolvePeer = createPeerCallResolver({ workspaceId: "local", resolveCredential, httpClient, publishHistory: { store, clock } });
  expect(resolveCredential).not.toHaveBeenCalled();
  expect(await resolvePeer({ peerId: "remote-7" })).toStrictEqual({
    credential, httpClient, publishHistory: { store, clock, workspaceId: "local" },
  });
  expect(resolveCredential.mock.calls).toEqual([[{ workspaceId: "local", id: "remote-7" }]]);
  expect(httpClient.send).not.toHaveBeenCalled();
});
