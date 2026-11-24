import { describe, expect, it } from "vitest";

import { capabilitiesRoute, type CapabilitiesGrant, type CapabilitiesRouteDeps } from "../capabilities.js";
import { WORKSPACE_ID } from "./transport-helpers.js";

/** @file The capabilities spec: the `publish_content.apply` gate, the registered-type allowlist and the grant intersection. */

const PRINCIPAL = { id: "u1" };

function makeDeps(overrides: Partial<CapabilitiesRouteDeps> = {}) {
  const reads = { handlers: 0, trust: [] as unknown[] };
  const deps: CapabilitiesRouteDeps = {
    workspaceId: WORKSPACE_ID,
    handlers: () => { reads.handlers += 1; return [{ entityType: "post", schemaVersion: 1 }, { entityType: "media", schemaVersion: 2 }, { entityType: "raw-row", schemaVersion: 3 }]; },
    publishTrust: ({ context }) => { reads.trust.push(context); return null; },
    isBackstopEntityType: ({ entityType }) => entityType.startsWith("raw-"),
    backstopGrantAllows: ({ grant, entityType }) => Boolean(grant?.entityTypes.includes(entityType) && grant.entityTypes.includes("backstop")),
    ...overrides,
  };
  return { deps, reads };
}

async function run({ deps, denied = false, authorize: given }: { deps: CapabilitiesRouteDeps; denied?: boolean; authorize?: null }) {
  const calls: unknown[] = [];
  const authorize = async (args: { permission: string; entityType?: string }, ...scope: unknown[]) => {
    calls.push(scope.length ? [args, ...scope] : args);
    if (denied) throw new Error("denied");
  };
  const parsed = capabilitiesRoute.parse({ body: undefined, query: {}, params: { workspaceId: WORKSPACE_ID } });
  if (!parsed.ok) throw new Error("parse refused");
  const result = await capabilitiesRoute.handle({ input: parsed.value, deps, context: PRINCIPAL, ...(given === null ? {} : { authorize }) });
  return { result, calls };
}

const grant = (entityTypes: readonly string[]): CapabilitiesGrant => ({ entityTypes });

describe("capabilitiesRoute", () => {
  it("pins method, path, the default 200 and no body cap", () => {
    expect(capabilitiesRoute.method).toBe("get");
    expect(capabilitiesRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/publish-content/capabilities");
    expect(capabilitiesRoute.successStatus).toBeUndefined();
    expect(capabilitiesRoute.maxBodyBytes).toBeUndefined();
  });

  it("asks publish_content.apply once, with no entity type and no scope", async () => {
    const { deps } = makeDeps();
    const { calls } = await run({ deps });
    expect(calls).toEqual([{ permission: "publish_content.apply" }]);
  });

  it("a denied permission reads neither the catalog nor the grant", async () => {
    const { deps, reads } = makeDeps();
    await expect(run({ deps, denied: true })).rejects.toThrow("denied");
    expect(reads).toEqual({ handlers: 0, trust: [] });
  });

  it("fails closed on a mount with no authorizer (a wiring bug)", async () => {
    const { deps, reads } = makeDeps();
    await expect(run({ deps, authorize: null })).rejects.toThrow(/no authorizer/);
    expect(reads.handlers).toBe(0);
  });

  it("with no grant answers every registered non-raw type; raw types need the backstop grant", async () => {
    const { deps, reads } = makeDeps();
    const { result } = await run({ deps });
    expect(result).toEqual({ ok: true, value: { entityTypes: ["post", "media"], schemaVersions: { post: 1, media: 2 }, features: ["overwrite-live"] } });
    expect(reads.trust).toEqual([PRINCIPAL]);
  });

  it("with a grant answers the intersection, and a raw type only when the backstop rule allows it", async () => {
    const narrow = makeDeps({ publishTrust: () => grant(["post", "raw-row", "unregistered"]) });
    expect((await run({ deps: narrow.deps })).result).toEqual({ ok: true, value: { entityTypes: ["post"], schemaVersions: { post: 1 }, features: ["overwrite-live"] } });
    const backstop = makeDeps({ publishTrust: () => grant(["media", "raw-row", "backstop"]) });
    expect((await run({ deps: backstop.deps })).result).toEqual({ ok: true, value: { entityTypes: ["media", "raw-row"], schemaVersions: { media: 2, "raw-row": 3 }, features: ["overwrite-live"] } });
  });

  it("an empty grant allows nothing", async () => {
    const { deps } = makeDeps({ publishTrust: () => grant([]) });
    expect((await run({ deps })).result).toEqual({ ok: true, value: { entityTypes: [], schemaVersions: {}, features: ["overwrite-live"] } });
  });

  it("an unexpected failure is rethrown unchanged (the host 500)", async () => {
    const { deps } = makeDeps({ handlers: () => { throw new Error("registry exploded"); } });
    await expect(run({ deps })).rejects.toThrow("registry exploded");
  });
});
