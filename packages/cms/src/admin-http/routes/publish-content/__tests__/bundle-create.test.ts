import { describe, expect, it } from "vitest";

import { InMemoryPublishContentBundleRepo, PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION } from "../../../../publish/transfer/index.js";
import { bundleCreateRoute, validateBundleBody, type BundleCreateGrant, type BundleCreateRouteDeps } from "../bundle-create.js";
import { WORKSPACE_ID, refusalOf } from "./transport-helpers.js";

/** @file The bundle staging spec: envelope refusals, the door checks in order, and the stage itself. */

const PRINCIPAL = { id: "u1" };

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { artifactFormatVersion: PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION, hashVersion: 1, sourceLabel: "source", entities: [], blobManifest: [], ...overrides };
}

function makeDeps(overrides: Partial<BundleCreateRouteDeps> = {}) {
  const repo = new InMemoryPublishContentBundleRepo();
  const trustReads: unknown[] = [];
  const deps: BundleCreateRouteDeps = {
    workspaceId: WORKSPACE_ID,
    bundleRepo: repo,
    clock: { nowMs: () => Date.parse("2026-11-23T00:00:00.000Z"), nowIso: () => "2026-11-23T00:00:00.000Z" } as unknown as BundleCreateRouteDeps["clock"],
    idGen: { newId: () => "bundle-1" },
    schemaVersions: () => new Map([["post", 1]]),
    publishTrust: ({ context }) => { trustReads.push(context); return null; },
    isBackstopEntityType: ({ entityType }) => entityType.startsWith("raw-"),
    backstopGrantAllows: () => false,
    readBackstopMetadata: () => null,
    backstopAuditReady: async () => true,
    ...overrides,
  };
  return { deps, repo, trustReads };
}

function recording(denied = false) {
  const calls: unknown[] = [];
  return { calls, authorize: async (args: { permission: string; entityType?: string }, ...scope: unknown[]) => {
    calls.push(scope.length ? [args, ...scope] : args);
    if (denied) throw new Error("denied");
  } };
}

async function run({ body, deps, host = "dest.example", denied = false }: { body: unknown; deps: BundleCreateRouteDeps; host?: string; denied?: boolean }) {
  const auth = recording(denied);
  const parsed = bundleCreateRoute.parse({ body, query: {}, params: { workspaceId: WORKSPACE_ID }, facts: { clientAddress: "1.2.3.4", host } });
  if (!parsed.ok) throw new Error("parse refused");
  const result = await bundleCreateRoute.handle({ input: parsed.value, deps, context: PRINCIPAL, authorize: auth.authorize });
  return { result, auth };
}

describe("bundleCreateRoute", () => {
  it("pins method, path, 201 and no spec body cap (the host keeps its own 413 binding)", () => {
    expect(bundleCreateRoute.method).toBe("post");
    expect(bundleCreateRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/publish-content/bundles");
    expect(bundleCreateRoute.successStatus).toBe(201);
    expect(bundleCreateRoute.maxBodyBytes).toBeUndefined();
  });

  it("parse hands the raw body and the request Host through untouched", () => {
    const body = { anything: true };
    expect(bundleCreateRoute.parse({ body, query: {}, params: {}, facts: { clientAddress: "x", host: "h.example" } })).toEqual({ ok: true, value: { body, host: "h.example" } });
    expect(bundleCreateRoute.parse({ body, query: {}, params: {} })).toEqual({ ok: true, value: { body, host: undefined } });
  });

  it.each([
    ["no artifactFormatVersion", envelope({ artifactFormatVersion: undefined }), "artifactFormatVersion must be an integer"],
    ["a future format", envelope({ artifactFormatVersion: PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION + 1 }), `unsupported artifactFormatVersion ${PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION + 1}; this instance supports ${PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION}`],
    ["a fractional hashVersion", envelope({ hashVersion: 1.5 }), "hashVersion must be an integer"],
    ["entities not an array", envelope({ entities: {} }), "entities must be an array"],
    ["a non-object entity", envelope({ entities: [null] }), "entities[0] must be an object"],
    ["an empty entityType", envelope({ entities: [{ entityType: "", schemaVersion: 1 }] }), "entities[0].entityType must be a non-empty string"],
    ["a missing schemaVersion", envelope({ entities: [{ entityType: "post" }] }), "entities[0].schemaVersion must be an integer"],
    ["a non-string manifest entry", envelope({ blobManifest: [1] }), "blobManifest must be an array of strings"],
    ["a numeric sourceLabel", envelope({ sourceLabel: 3 }), "sourceLabel must be a string when present"],
  ])("refuses %s with the exact flat 400, after authorization", async (_name, body, error) => {
    const { deps, repo } = makeDeps();
    expect(validateBundleBody({ rawBody: body })).toEqual({ error });
    expect(await refusalOf(() => run({ body, deps }))).toEqual({ status: 400, body: { error } });
    expect(await repo.findById({ workspaceId: WORKSPACE_ID, id: "bundle-1" }).catch(() => null)).toBeNull();
  });

  it("asks publish_content.apply with no entity type and no scope, before reading the body", async () => {
    const { deps } = makeDeps();
    const { auth } = await run({ body: envelope(), deps });
    expect(auth.calls).toEqual([{ permission: "publish_content.apply" }]);
    await expect(run({ body: envelope({ hashVersion: "x" }), deps, denied: true })).rejects.toThrow("denied");
  });

  it("fails closed without an authorizer or a principal (wiring bug)", async () => {
    const { deps } = makeDeps();
    const input = { body: envelope(), host: "h" };
    await expect(bundleCreateRoute.handle({ input, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    await expect(bundleCreateRoute.handle({ input, deps, context: undefined, authorize: recording().authorize })).rejects.toThrow(/no authenticated principal/);
  });

  it("refuses a registered type at another schemaVersion, before reading the grant", async () => {
    const { deps, trustReads } = makeDeps();
    const body = envelope({ entities: [{ entityType: "post", schemaVersion: 2 }] });
    expect(await refusalOf(() => run({ body, deps }))).toEqual({ status: 400, body: { error: "unsupported schemaVersion 2 for entity type 'post'; this instance supports 1" } });
    expect(trustReads).toEqual([]);
  });

  it("refuses a raw entity without the backstop grant, then a type outside the grant", async () => {
    const grant: BundleCreateGrant = { entityTypes: ["post", "raw-row"] };
    const asked: unknown[] = [];
    const { deps, trustReads } = makeDeps({ publishTrust: ({ context }) => { trustReads.push(context); return grant; }, backstopGrantAllows: (args) => { asked.push(args); return false; } });
    expect(await refusalOf(() => run({ body: envelope({ entities: [{ entityType: "raw-row", schemaVersion: 1 }] }), deps }))).toEqual({ status: 403, body: {
      error: "Send by hand requires the destination's backstop grant and raw entity type.", code: "FORBIDDEN", details: { permission: "publish_content.backstop", reason: "backstop_not_granted" } } });
    expect(asked).toEqual([{ grant, entityType: "raw-row" }]);
    expect(trustReads).toEqual([PRINCIPAL]);
    expect(await refusalOf(() => run({ body: envelope({ entities: [{ entityType: "media", schemaVersion: 1 }] }), deps }))).toEqual({ status: 403, body: {
      error: "this bundle carries an entity type outside the publishing grant", code: "FORBIDDEN", details: { permission: "publish_content.apply", reason: "entity_type_not_granted" } } });
  });

  it("with no grant, any type passes the allowlist (an explicitly configured peer key)", async () => {
    const { deps } = makeDeps();
    const { result } = await run({ body: envelope({ entities: [{ entityType: "media", schemaVersion: 9 }] }), deps });
    expect(result).toEqual({ ok: true, value: { bundleId: "bundle-1", expiresAt: expect.any(String) } });
  });

  it("answers the manual-send checks: unreadable details 400, wrong host 400, no audit storage 503", async () => {
    const unreadable = makeDeps({ readBackstopMetadata: () => { throw new Error("bad send details"); } }).deps;
    expect(await refusalOf(() => run({ body: envelope(), deps: unreadable }))).toEqual({ status: 400, body: { error: "bad send details" } });
    const wrongHost = makeDeps({ readBackstopMetadata: () => ({ destinationHost: "other.example" }) }).deps;
    expect(await refusalOf(() => run({ body: envelope(), deps: wrongHost }))).toEqual({ status: 400, body: { error: "The confirmed live address does not match this destination." } });
    const noAudit = makeDeps({ readBackstopMetadata: () => ({ destinationHost: "dest.example" }), backstopAuditReady: async () => false }).deps;
    expect(await refusalOf(() => run({ body: envelope(), deps: noAudit }))).toEqual({ status: 503, body: {
      error: "Send by hand needs its audit storage installed before it can send anything.", code: "BACKSTOP_NOT_INSTALLED" } });
    const ready = makeDeps({ readBackstopMetadata: () => ({ destinationHost: "dest.example" }) }).deps;
    expect((await run({ body: envelope(), deps: ready })).result.ok).toBe(true);
  });

  it("stages the bundle under the authenticated principal, never a body-declared one", async () => {
    const { deps, repo } = makeDeps();
    const { result } = await run({ body: envelope({ sourcePrincipalId: "attacker", sourceLabel: undefined }), deps });
    expect(result).toEqual({ ok: true, value: { bundleId: "bundle-1", expiresAt: expect.any(String) } });
    const staged = await repo.findById({ workspaceId: WORKSPACE_ID, id: "bundle-1" });
    expect(staged).toMatchObject({ sourcePrincipalId: "u1", workspaceId: WORKSPACE_ID });
  });
});
