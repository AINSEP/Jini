import assert from "node:assert/strict";
import { test } from "vitest";

import { EntityNotLiveError } from "../../../core/entity-liveness.js";
import { createVerifiedOrigin, InMemoryOriginSettingRepo, OriginRegistry } from "@jini-ai/core/contracts/server/verified-origin";
import { InMemoryOutbox } from "../../__tests__/support/events.fixture.js";
import { redirectMatcher } from "../../matcher.js";
import { InMemoryRedirectRepo } from "../../repo.memory.js";
import { createRedirect, updateRedirect, type RedirectsWriteDeps } from "../../redirects.js";
import { RedirectConflictError, RedirectLoopError, RedirectTargetNotAllowedError, RedirectValidationError } from "../../types.js";
import { contributeRedirectPublish, redirectNaturalKey, type RedirectRepoPublishConfig } from "../publish-content.js";

/**
 * @file The redirect publish-content config handed to the host's injected repo-backed factory: the
 * coverage claim uses the injected table name, the ports come from `deps.ports.redirect`, rows are
 * keyed and labelled by natural key, only active rows pack, a malformed key is refused at validate,
 * and write creates through the chokepoint as an import. The host's own characterization tests
 * pin the factory's own behaviour over this config.
 */

const WORKSPACE_ID = "workspace-1";

function makeDeps(repo: InMemoryRedirectRepo = new InMemoryRedirectRepo()): RedirectsWriteDeps {
  const originRepo = new InMemoryOriginSettingRepo({ seeds: [{
    workspaceId: WORKSPACE_ID,
    origin: createVerifiedOrigin({ scheme: "https", host: "trusted.example", verifiedAt: "2026-07-13T00:00:00.000Z", source: "workspace-setting" }),
    redirectAllowlist: [],
  }] });
  let idTick = 0;
  return {
    reservedSegments: new Set(["admin", "api"]),
    repo,
    remove: async () => ({ ok: true, version: null }),
    isInTrash: async () => false,
    restore: async () => "restored",
    db: repo,
    transaction: async (fn) => fn(),
    matcher: redirectMatcher,
    originRegistry: new OriginRegistry({ repo: originRepo }),
    clock: { nowMs: () => Date.parse("2026-07-13T00:00:00.000Z") },
    idGen: { newId: () => `redirect-${++idTick}` },
    outbox: new InMemoryOutbox(),
  };
}

/** The injected factory: hands back the config it received, standing in for the host's contributor. */
function captureConfig(): RedirectRepoPublishConfig {
  return contributeRedirectPublish({ createRepoPublishHandler: (config) => config, redirectsTable: "site_redirects" });
}

test("the config claims the injected table and redirects' own permission and blocked errors", () => {
  const config = captureConfig();
  assert.equal(config.entityType, "redirect");
  assert.deepEqual(config.coversTables, ["site_redirects"]);
  assert.equal(config.permission, "admin.redirects.manage");
  assert.deepEqual(config.errors.blocked, [RedirectValidationError, RedirectTargetNotAllowedError, RedirectLoopError, RedirectConflictError, EntityNotLiveError]);
  const deps = makeDeps();
  assert.equal(config.ports({ deps: { ports: { redirect: deps } } }), deps);
  assert.equal(config.ports({ deps: { ports: {} } }), undefined);
});

test("rows are keyed by natural key, titled for the operator, and only active rows pack", async () => {
  const config = captureConfig();
  const deps = makeDeps();
  const { record } = await createRedirect({ deps, input: { workspaceId: WORKSPACE_ID, matchType: "prefix", fromPattern: "/old:a", toTarget: "/new", statusCode: 301, actorId: "u" } });
  const [row] = await config.list({ ports: deps, workspaceId: WORKSPACE_ID });
  assert.equal(row?.title, "starts with /old:a → /new");
  assert.equal(config.idOf({ row: row! }), "prefix:/old:a");
  assert.equal(redirectNaturalKey({ matchType: "prefix", fromPattern: "/old:a" }), "prefix:/old:a");
  assert.equal(config.include({ row: row! }), true);
  assert.equal(config.include({ row: { ...row!, status: "disabled" } }), false);
  assert.equal((await config.find({ ports: deps, workspaceId: WORKSPACE_ID, id: "prefix:/old:a" }))?.id, record.id);
  assert.equal(await config.find({ ports: deps, workspaceId: WORKSPACE_ID, id: "no-colon" }), null);
});

test("validate refuses a malformed key and write creates an import through the chokepoint", async () => {
  const config = captureConfig();
  const deps = makeDeps();
  const state = { matchType: "exact", fromPattern: "/from", toTarget: "/to", statusCode: 302, override: false, priority: 0, status: "active" };
  const refusal = await config.validate({ ports: deps, workspaceId: WORKSPACE_ID, entity: { id: "bad", state } as never, existing: null });
  assert.match(String(refusal), /malformed natural key/);
  assert.equal(await config.validate({ ports: deps, workspaceId: WORKSPACE_ID, entity: { id: "exact:/from", state } as never, existing: null }), null);
  const { changeSetId } = await config.write({ ports: deps, workspaceId: WORKSPACE_ID, id: "exact:/from", state, existing: null, principalId: "p1" });
  const stored = await deps.repo.list({ workspaceId: WORKSPACE_ID });
  assert.deepEqual(stored.map((r) => [r.id, r.source, r.statusCode, r.createdByPrincipal]), [[changeSetId, "import", 302, "p1"]]);
  await assert.rejects(config.write({ ports: deps, workspaceId: WORKSPACE_ID, id: "bad", state, existing: null, principalId: "p1" }), /malformed natural key 'bad'/);
});

test("a redirect mapped to packed state and applied elsewhere yields the same records, and re-apply updates in place", async () => {
  const config = captureConfig();
  const source = makeDeps();
  const target = makeDeps();
  await createRedirect({ deps: source, input: { workspaceId: WORKSPACE_ID, matchType: "prefix", fromPattern: "/old:a", toTarget: "/new", statusCode: 301, override: true, priority: 4, actorId: "u" } });
  await createRedirect({ deps: source, input: { workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/x", toTarget: "/y", statusCode: 302, actorId: "u" } });
  const transferred = Object.entries(config.fields).filter(([, d]) => d === "transferred").map(([name]) => name);
  const packed = (await config.list({ ports: source, workspaceId: WORKSPACE_ID })).filter((row) => config.include({ row })).map((row) => ({
    id: config.idOf({ row }), state: Object.fromEntries(transferred.map((name) => [name, (row as unknown as Record<string, unknown>)[name]])),
  }));
  assert.equal(packed.length, 2);
  for (const { id, state } of packed) {
    assert.equal(await config.validate({ ports: target, workspaceId: WORKSPACE_ID, entity: { id, state } as never, existing: null }), null);
    await config.write({ ports: target, workspaceId: WORKSPACE_ID, id, state, existing: null, principalId: "p1" });
  }
  const pick = (rows: readonly object[]) => rows.map((r) => Object.fromEntries(transferred.map((name) => [name, (r as Record<string, unknown>)[name]]))).sort((a, b) => String(a.fromPattern).localeCompare(String(b.fromPattern)));
  const copied = await target.repo.list({ workspaceId: WORKSPACE_ID });
  assert.deepEqual(pick(copied), pick(await source.repo.list({ workspaceId: WORKSPACE_ID })));
  const existing = await config.find({ ports: target, workspaceId: WORKSPACE_ID, id: "exact:/x" });
  await config.write({ ports: target, workspaceId: WORKSPACE_ID, id: "exact:/x", state: { ...packed[1]!.state, toTarget: "/z" }, existing, principalId: "p1" });
  const after = await target.repo.list({ workspaceId: WORKSPACE_ID });
  assert.deepEqual(after.map((r) => r.id).sort(), copied.map((r) => r.id).sort());
  assert.equal(after.find((r) => r.fromPattern === "/x")?.toTarget, "/z");
});

test("legacy packed state without status reactivates the same disabled rule and valid misses return null", async () => {
  const config = captureConfig();
  const ports = makeDeps();
  const id = "exact:/retired";
  assert.equal(await config.find({ ports, workspaceId: WORKSPACE_ID, id }), null);
  const { record } = await createRedirect({ deps: ports, input: {
    workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/retired", toTarget: "/old", statusCode: 301, actorId: "owner",
  } });
  const { record: disabled } = await updateRedirect({ deps: ports, input: {
    workspaceId: WORKSPACE_ID, id: record.id, status: "disabled", actorId: "owner",
  } });
  const existing = await config.find({ ports, workspaceId: WORKSPACE_ID, id });
  assert.equal(existing?.id, disabled.id);
  assert.equal(existing?.status, "disabled");
  const state = { matchType: "exact", fromPattern: "/retired", toTarget: "/new", statusCode: 302, override: false, priority: 0 };
  const entity = { entityType: "redirect", id, schemaVersion: 1, hashVersion: 1, contentHash: "test", requiredBlobs: [], state };
  assert.equal(await config.validate({ ports, workspaceId: WORKSPACE_ID, existing, entity }), null);
  assert.deepEqual(await config.write({ ports, workspaceId: WORKSPACE_ID, id, state, existing, principalId: "publisher" }),
    { changeSetId: record.id });
  const rows = await ports.repo.list({ workspaceId: WORKSPACE_ID });
  assert.deepEqual(rows.map(row => [row.id, row.status, row.toTarget, row.statusCode, row.version]),
    [[record.id, "active", "/new", 302, disabled.version + 1]]);
});
