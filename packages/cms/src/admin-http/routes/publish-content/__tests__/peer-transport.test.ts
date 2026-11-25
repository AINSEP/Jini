import { describe, expect, it } from "vitest";

import type { PeerCallDeps } from "../../../../publish/content/peer-transport.js";
import { peerPushPlanRoute, peerPushConfirmRoute, peerPushExecuteRoute, peerPullRoute, type PeerActionRefusalFn } from "../peer-transport.js";
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
