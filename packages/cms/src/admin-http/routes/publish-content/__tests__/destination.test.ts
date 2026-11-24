import { describe, expect, it } from "vitest";

import { destinationConnectRoute, destinationDisconnectRoute, destinationReadRoute } from "../destination.js";
import { PEER, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./transport-helpers.js";

class HandshakeError extends Error {}
class NotSavedError extends Error {}
const SITE = { id: "p1", label: "live.example", baseUrl: "https://live.example", remoteWorkspaceId: "rw" };
const SITE_VIEW = { ...SITE, masked: null, hasCredential: false };

function makeDeps(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ op: string; input?: unknown }> = [];
  const deps = {
    workspaceId: WORKSPACE_ID,
    destinationErrors: { handshake: HandshakeError, notSaved: NotSavedError },
    findConnectedPeer: async (input: { workspaceId: string }) => { calls.push({ op: "connected", input }); return null; },
    findCandidate: async () => { calls.push({ op: "candidate" }); return "https://candidate.example" as string | null; },
    listPublishableTypes: () => ["post", "page"],
    connectDestination: async (input: unknown) => { calls.push({ op: "connect", input }); return { site: PEER, grant: { nextStep: "Deploy once." } }; },
    disconnectDestination: async (input: unknown) => {
      calls.push({ op: "disconnect", input });
      return { site: { label: "live.example", baseUrl: "https://live.example" }, changed: true, target: { nextStep: "Redeploy." } };
    },
    ...overrides,
  };
  return { deps, calls };
}

const BASE = "/api/admin/v1/workspaces/:workspaceId/publish-content/destination";

describe("publish-content destination route specs", () => {
  it("pins method, path, success status and body cap", () => {
    expect([destinationReadRoute.method, destinationReadRoute.path, destinationReadRoute.successStatus]).toEqual(["get", BASE, undefined]);
    expect([destinationConnectRoute.method, destinationConnectRoute.path, destinationConnectRoute.successStatus, destinationConnectRoute.maxBodyBytes]).toEqual(["post", `${BASE}/connect`, 201, undefined]);
    expect([destinationDisconnectRoute.method, destinationDisconnectRoute.path, destinationDisconnectRoute.successStatus]).toEqual(["post", `${BASE}/disconnect`, undefined]);
  });

  it("parses siteUrl only when it is a non-blank string", () => {
    expect(destinationConnectRoute.parse(raw({}, { siteUrl: "https://x.example" }))).toEqual({ ok: true, value: { siteUrl: "https://x.example" } });
    for (const body of [undefined, {}, { siteUrl: "  " }, { siteUrl: 42 }]) {
      expect(destinationConnectRoute.parse(raw({}, body))).toEqual({ ok: true, value: { siteUrl: null } });
    }
  });

  it("reads the connected site as a credential-free summary, under publish_content.apply", async () => {
    const { deps } = makeDeps({ findConnectedPeer: async () => ({ ...SITE, sealedCiphertext: "LEAK" }) });
    const auth = recordingAuthorize();
    expect(await destinationReadRoute.handle({ input: {}, deps, authorize: auth.authorize })).toEqual({ ok: true, value: {
      connected: true, site: SITE_VIEW, candidateUrl: null, message: "This computer publishes to live.example.", nextStep: null,
    } });
    expect(auth.calls).toEqual([{ permission: "publish_content.apply", entityType: "publish-destination" }]);
  });

  it("offers the deploy-config candidate, or the plain empty-state sentence", async () => {
    const { authorize } = recordingAuthorize();
    expect(await destinationReadRoute.handle({ input: {}, deps: makeDeps().deps, authorize })).toEqual({ ok: true, value: {
      connected: false, site: null, candidateUrl: "https://candidate.example", message: "Publish to candidate.example?", nextStep: null,
    } });
    const none = makeDeps({ findCandidate: async () => null }).deps;
    expect(await destinationReadRoute.handle({ input: {}, deps: none, authorize })).toEqual({ ok: true, value: {
      connected: false, site: null, candidateUrl: null, message: "No live site is set up yet. Deploy this site once, then come back here.", nextStep: null,
    } });
  });

  it("connects the normalized address with this install's own types and answers the grant's next step", async () => {
    const { deps, calls } = makeDeps();
    const { authorize } = recordingAuthorize();
    expect(await destinationConnectRoute.handle({ input: { siteUrl: "https://Live.Example/" }, deps, authorize })).toEqual({ ok: true, value: {
      connected: true, site: PEER, candidateUrl: null, message: "This computer publishes to Live.", nextStep: "Deploy once.",
    } });
    expect(calls).toEqual([{ op: "connect", input: { workspaceId: WORKSPACE_ID, baseUrl: "https://live.example", entityTypes: ["post", "page"] } }]);
  });

  it("refuses connect with the exact flat bodies, after authorization", async () => {
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => destinationConnectRoute.handle({ input: { siteUrl: null }, deps: makeDeps({ findCandidate: async () => null }).deps, authorize })))
      .toEqual({ status: 400, body: { error: "No live site is set up yet. Deploy this site once, then come back here.", code: "NO_DESTINATION" } });
    expect(await refusalOf(() => destinationConnectRoute.handle({ input: { siteUrl: "not a url" }, deps: makeDeps().deps, authorize })))
      .toEqual({ status: 400, body: { error: "That does not look like a website address.", code: "VALIDATION_ERROR" } });
    expect(await refusalOf(() => destinationConnectRoute.handle({ input: { siteUrl: "https://x.example" }, deps: makeDeps({ listPublishableTypes: () => [] }).deps, authorize })))
      .toEqual({ status: 409, body: { error: "This site has nothing that can be published yet.", code: "NO_PUBLISHABLE_TYPES" } });
  });

  it("disconnects, keeping the forgotten address as the candidate and the reversal's next step", async () => {
    const { deps, calls } = makeDeps();
    const { authorize } = recordingAuthorize();
    expect(await destinationDisconnectRoute.handle({ input: {}, deps, authorize })).toEqual({ ok: true, value: {
      connected: false, site: null, candidateUrl: "https://live.example", message: "This computer no longer publishes to live.example.", nextStep: "Redeploy.",
    } });
    expect(calls).toEqual([{ op: "disconnect", input: { workspaceId: WORKSPACE_ID } }]);
    const idle = makeDeps({ disconnectDestination: async () => ({ site: null, changed: false, target: { nextStep: "x" } }) }).deps;
    expect(await destinationDisconnectRoute.handle({ input: {}, deps: idle, authorize })).toEqual({ ok: true, value: {
      connected: false, site: null, candidateUrl: "https://candidate.example", message: "This computer was not publishing anywhere.", nextStep: null,
    } });
  });

  it("an auth refusal stops every side effect", async () => {
    const { deps, calls } = makeDeps();
    const { authorize } = recordingAuthorize(["publish_content.apply"]);
    await expect(destinationReadRoute.handle({ input: {}, deps, authorize })).rejects.toThrow("denied");
    await expect(destinationConnectRoute.handle({ input: { siteUrl: null }, deps, authorize })).rejects.toThrow("denied");
    await expect(destinationDisconnectRoute.handle({ input: {}, deps, authorize })).rejects.toThrow("denied");
    expect(calls).toEqual([]);
  });

  it("maps the injected handshake/not-saved classes; rethrows anything else unchanged", async () => {
    const { authorize } = recordingAuthorize();
    const failing = (error: Error) => makeDeps({ connectDestination: async () => { throw error; }, disconnectDestination: async () => { throw error; } }).deps;
    expect(await refusalOf(() => destinationConnectRoute.handle({ input: { siteUrl: "https://x.example" }, deps: failing(new HandshakeError("site said no")), authorize })))
      .toEqual({ status: 502, body: { error: "site said no", code: "PUBLISH_TRUST_HANDSHAKE_FAILED" } });
    expect(await refusalOf(() => destinationDisconnectRoute.handle({ input: {}, deps: failing(new NotSavedError("grant not written")), authorize })))
      .toEqual({ status: 500, body: { error: "grant not written", code: "PUBLISH_TRUST_NOT_SAVED" } });
    const driver = new Error("EACCES /private");
    await expect(destinationConnectRoute.handle({ input: { siteUrl: "https://x.example" }, deps: failing(driver), authorize })).rejects.toBe(driver);
  });

  it("fails closed without an authorizer", async () => {
    const { deps, calls } = makeDeps();
    await expect(destinationReadRoute.handle({ input: {}, deps })).rejects.toThrow(/no authorizer/);
    expect(calls).toEqual([]);
  });
});
