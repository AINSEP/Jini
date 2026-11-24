import { describe, expect, it } from "vitest";

import { settingsGetRawRoute } from "../get-raw.js";
import { settingsGetEffectiveRoute } from "../get-effective.js";
import { settingsListDefinitionsRoute } from "../list-definitions.js";
import { CROSS_READ, PRINCIPAL, baseDeps, invoke, recordingAuthorize, refusalOf } from "./helpers.js";

const BASE = "/api/admin/v1/workspaces/:workspaceId/settings";
const RAW = { namespace: "n", key: "k", definition: null, layers: [] } as never;

function readDeps({ allowed = true, raw = RAW as unknown }: { allowed?: boolean; raw?: unknown } = {}) {
  const calls: Array<{ method: string; input: unknown }> = [];
  const targets: unknown[] = [];
  return {
    calls, targets,
    deps: {
      ...baseDeps(), crossPrincipalReadPermission: CROSS_READ,
      resolveReadTarget: async (input: { requestedPrincipalId: string | undefined; callerPrincipalId: string }) => {
        targets.push(input);
        return allowed ? { allowed: true as const, principalId: input.requestedPrincipalId } : { allowed: false as const, reason: "denied-by-test" };
      },
      settingsService: () => ({
        raw: async (input: unknown) => { calls.push({ method: "raw", input }); return raw as never; },
        effective: async (input: unknown) => { calls.push({ method: "effective", input }); return [{ key: "k" }] as never; },
        listDefinitions: async () => [
          { namespace: "b", key: "a", ownerKind: "core", scopes: 1, status: "active", version: 1, secret: true },
          { namespace: "a", key: "z", ownerKind: "site", scopes: 3, status: "active", version: 2 },
        ] as never,
      }),
    },
  };
}

describe("settings read specs", () => {
  it("pin method, path and no body cap", () => {
    expect([settingsGetRawRoute, settingsGetEffectiveRoute, settingsListDefinitionsRoute].map((r) => [r.method, r.path, r.successStatus, r.maxBodyBytes]))
      .toEqual([["get", `${BASE}/raw`, undefined, undefined], ["get", `${BASE}/effective`, undefined, undefined], ["get", `${BASE}/definitions`, undefined, undefined]]);
  });

  it("GET raw: authorizes settings.read.raw with no entityId BEFORE validating the query", async () => {
    const { deps } = readDeps();
    const auth = recordingAuthorize();
    expect(await refusalOf(() => invoke(settingsGetRawRoute, { deps, query: { namespace: "n" }, authorize: auth.authorize })))
      .toEqual({ status: 400, body: { error: "'namespace' and 'key' query params are required", code: "VALIDATION_ERROR" } });
    expect(auth.calls).toEqual([{ permission: "settings.read.raw", entityType: "setting-value" }]);
    const denied = recordingAuthorize(["settings.read.raw"]);
    await expect(invoke(settingsGetRawRoute, { deps, query: {}, authorize: denied.authorize })).rejects.toThrow("denied settings.read.raw");
  });

  it("GET raw: reads the authorized workspace for the requested principal through the injected service", async () => {
    const { deps, calls, targets } = readDeps();
    expect(await invoke(settingsGetRawRoute, { deps, query: { namespace: "n", key: "k", principalId: "p2", workspaceId: "other" } })).toBe(RAW);
    expect(targets).toEqual([{ requestedPrincipalId: "p2", callerPrincipalId: PRINCIPAL.id }]);
    expect(calls).toEqual([{ method: "raw", input: { namespace: "n", key: "k", workspaceId: "ws-1", principalId: "p2" } }]);
  });

  it("GET raw: a denied cross-principal read is the exact 403 with the injected permission; no read happens", async () => {
    const { deps, calls } = readDeps({ allowed: false });
    expect(await refusalOf(() => invoke(settingsGetRawRoute, { deps, query: { namespace: "n", key: "k", principalId: "p2" } }))).toEqual({ status: 403, body: {
      error: "principal 'principal-1' is not authorized to read another principal's user-layer value (denied-by-test)",
      code: "FORBIDDEN", details: { permission: CROSS_READ, reason: "denied-by-test" },
    } });
    expect(calls).toEqual([]);
  });

  it("GET raw: a missing definition is 404 DEFINITION_NOT_FOUND", async () => {
    const { deps } = readDeps({ raw: null });
    expect(await refusalOf(() => invoke(settingsGetRawRoute, { deps, query: { namespace: "n", key: "k" } })))
      .toEqual({ status: 404, body: { error: "definition 'n.k' was not found", code: "DEFINITION_NOT_FOUND" } });
  });

  it("GET effective: 400 plain-words copy after authorizing; defaults the user layer to the caller", async () => {
    const { deps, calls, targets } = readDeps();
    const auth = recordingAuthorize();
    expect(await refusalOf(() => invoke(settingsGetEffectiveRoute, { deps, authorize: auth.authorize }))).toEqual({ status: 400, body: {
      error: "Say which group of settings to read: add ?namespace=<group> to the address, for example ?namespace=core.language.", code: "VALIDATION_ERROR" } });
    expect(auth.calls).toEqual([{ permission: "settings.read", entityType: "setting-value" }]);
    expect(await invoke(settingsGetEffectiveRoute, { deps, query: { namespace: "n" } })).toEqual({ data: [{ key: "k" }] });
    expect(targets).toEqual([{ requestedPrincipalId: PRINCIPAL.id, callerPrincipalId: PRINCIPAL.id }]);
    expect(calls).toEqual([{ method: "effective", input: { namespace: "n", workspaceId: "ws-1", principalId: PRINCIPAL.id } }]);
  });

  it("GET effective: a denied cross-principal read is the exact 403", async () => {
    const { deps } = readDeps({ allowed: false });
    expect((await refusalOf(() => invoke(settingsGetEffectiveRoute, { deps, query: { namespace: "n", principalId: "p2" } }))).status).toBe(403);
  });

  it("GET definitions: authorizes, projects and sorts by namespace then key", async () => {
    const { deps } = readDeps();
    const auth = recordingAuthorize();
    expect(await invoke(settingsListDefinitionsRoute, { deps, authorize: auth.authorize })).toEqual({ data: [
      { namespace: "a", key: "z", ownerKind: "site", scopes: 3, status: "active", version: 2 },
      { namespace: "b", key: "a", ownerKind: "core", scopes: 1, status: "active", version: 1 },
    ] });
    expect(auth.calls).toEqual([{ permission: "settings.read.definitions", entityType: "setting-definition" }]);
  });
});
