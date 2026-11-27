import { describe, expect, it } from "vitest";

import { peerCreateRoute, peerDeleteRoute, peerListRoute, peerUpdateRoute, type PublishPeerErrorClasses } from "../peers.js";
import { PEER, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./transport-helpers.js";

class ValidationError extends Error {}
class DuplicateLabelError extends Error {}
class NotFoundError extends Error {}
class SecretStoreError extends Error {}
const peerErrors: PublishPeerErrorClasses = {
  validation: ValidationError, duplicateLabel: DuplicateLabelError, notFound: NotFoundError, secretStoreUnconfigured: SecretStoreError,
};

/** Deps with recording collaborators; `fail` makes every collaborator throw it. */
function makeDeps(fail?: Error) {
  const calls: Array<{ op: string; input: unknown }> = [];
  const record = <T>(op: string, value: T) => async (input: unknown) => {
    calls.push({ op, input });
    if (fail) throw fail;
    return value;
  };
  return {
    calls,
    deps: {
      workspaceId: WORKSPACE_ID, peerErrors,
      listPeers: record("list", [PEER]), createPeer: record("create", PEER),
      updatePeer: record("update", PEER), deletePeer: record("delete", undefined),
    },
  };
}

const PEERS = "/api/admin/v1/workspaces/:workspaceId/publish-content/peers";

describe("publish-content peer route specs", () => {
  it("pins method, path, success status and body cap", () => {
    expect([peerListRoute.method, peerListRoute.path, peerListRoute.successStatus, peerListRoute.maxBodyBytes]).toEqual(["get", PEERS, undefined, undefined]);
    expect([peerCreateRoute.method, peerCreateRoute.path, peerCreateRoute.successStatus, peerCreateRoute.maxBodyBytes]).toEqual(["post", PEERS, 201, undefined]);
    expect([peerUpdateRoute.method, peerUpdateRoute.path, peerUpdateRoute.successStatus]).toEqual(["patch", `${PEERS}/:peerId`, undefined]);
    expect([peerDeleteRoute.method, peerDeleteRoute.path, peerDeleteRoute.successStatus]).toEqual(["delete", `${PEERS}/:peerId`, 204]);
  });

  it("parses the body as a field bag (absent → empty) and the :peerId param with its ?? \"\" fallback", () => {
    expect(peerCreateRoute.parse(raw({}, undefined))).toEqual({ ok: true, value: { body: {} } });
    // Strict: an absent key must stay absent (a present `undefined` would make PATCH a full replace).
    expect(peerUpdateRoute.parse(raw({}, { label: "x", other: 1 }))).toStrictEqual({ ok: true, value: { peerId: "", fields: { label: "x" } } });
    expect(peerUpdateRoute.parse(raw({ peerId: "p1" }, { apiKey: undefined }))).toEqual({ ok: true, value: { peerId: "p1", fields: { apiKey: undefined } } });
    expect(peerDeleteRoute.parse(raw({ peerId: "p1" }))).toEqual({ ok: true, value: { peerId: "p1" } });
  });

  it("lists under publish_content.read and answers { peers }", async () => {
    const { deps, calls } = makeDeps();
    const auth = recordingAuthorize();
    const result = await peerListRoute.handle({ input: {}, deps, authorize: auth.authorize });
    expect(result).toEqual({ ok: true, value: { peers: [PEER] } });
    expect(auth.calls).toEqual([{ permission: "publish_content.read", entityType: "publish-content-peer" }]);
    expect(calls).toEqual([{ op: "list", input: { workspaceId: WORKSPACE_ID } }]);
  });

  it("creates under publish_content.apply, forwarding exactly the four fields", async () => {
    const { deps, calls } = makeDeps();
    const auth = recordingAuthorize();
    const body = { label: "Live", baseUrl: "https://live.example", remoteWorkspaceId: "rw", apiKey: "k", extra: true };
    expect(await peerCreateRoute.handle({ input: { body }, deps, authorize: auth.authorize })).toEqual({ ok: true, value: { peer: PEER } });
    expect(auth.calls).toEqual([{ permission: "publish_content.apply", entityType: "publish-content-peer" }]);
    expect(calls).toEqual([{ op: "create", input: { workspaceId: WORKSPACE_ID, label: "Live", baseUrl: "https://live.example", remoteWorkspaceId: "rw", apiKey: "k" } }]);
  });

  it("updates only the present fields and deletes idempotently", async () => {
    const { deps, calls } = makeDeps();
    const auth = recordingAuthorize();
    expect(await peerUpdateRoute.handle({ input: { peerId: "p1", fields: { label: "New" } }, deps, authorize: auth.authorize })).toEqual({ ok: true, value: { peer: PEER } });
    expect(await peerDeleteRoute.handle({ input: { peerId: "p1" }, deps, authorize: auth.authorize })).toEqual({ ok: true, value: undefined });
    expect(calls).toEqual([
      { op: "update", input: { workspaceId: WORKSPACE_ID, id: "p1", label: "New" } },
      { op: "delete", input: { workspaceId: WORKSPACE_ID, id: "p1" } },
    ]);
    expect(auth.calls.map((c) => c.permission)).toEqual(["publish_content.apply", "publish_content.apply"]);
  });

  it("an auth refusal stops every side effect", async () => {
    const { deps, calls } = makeDeps();
    const auth = recordingAuthorize(["publish_content.read", "publish_content.apply"]);
    await expect(peerListRoute.handle({ input: {}, deps, authorize: auth.authorize })).rejects.toThrow("denied publish_content.read");
    await expect(peerCreateRoute.handle({ input: { body: {} }, deps, authorize: auth.authorize })).rejects.toThrow("denied");
    await expect(peerDeleteRoute.handle({ input: { peerId: "p" }, deps, authorize: auth.authorize })).rejects.toThrow("denied");
    expect(calls).toEqual([]);
  });

  it.each([
    [new ValidationError("bad url"), 400, "VALIDATION_ERROR"],
    [new DuplicateLabelError("taken"), 409, "DUPLICATE_LABEL"],
    [new NotFoundError("gone"), 404, "PEER_NOT_FOUND"],
    [new SecretStoreError("site key unset"), 503, "SECRET_STORE_UNCONFIGURED"],
  ])("maps the injected %s class to its exact flat body on every route", async (error, status, code) => {
    const { deps } = makeDeps(error);
    const { authorize } = recordingAuthorize();
    const expected = { status, body: { error: error.message, code } };
    expect(await refusalOf(() => peerListRoute.handle({ input: {}, deps, authorize }))).toEqual(expected);
    expect(await refusalOf(() => peerCreateRoute.handle({ input: { body: {} }, deps, authorize }))).toEqual(expected);
    expect(await refusalOf(() => peerUpdateRoute.handle({ input: { peerId: "p", fields: {} }, deps, authorize }))).toEqual(expected);
    expect(await refusalOf(() => peerDeleteRoute.handle({ input: { peerId: "p" }, deps, authorize }))).toEqual(expected);
  });

  it("rethrows an unmapped error unchanged (the host's redacted 500)", async () => {
    const driver = new Error("SQLITE_BUSY password=secret");
    const { deps } = makeDeps(driver);
    const { authorize } = recordingAuthorize();
    await expect(peerCreateRoute.handle({ input: { body: {} }, deps, authorize })).rejects.toBe(driver);
  });

  it("fails closed without an authorizer", async () => {
    const { deps, calls } = makeDeps();
    await expect(peerListRoute.handle({ input: {}, deps })).rejects.toThrow(/no authorizer/);
    expect(calls).toEqual([]);
  });
});

it("the peer list parser ignores caller-selected peer and workspace filters", () => {
  expect(peerListRoute.parse({ params: { workspaceId: WORKSPACE_ID }, query: { peerId: "hidden", workspaceId: "other" }, body: undefined }))
    .toStrictEqual({ ok: true, value: {} });
});
