import assert from "node:assert/strict";
import { test } from "vitest";

import { createVerifiedOrigin, InMemoryOriginSettingRepo, OriginRegistry } from "@jini-ai/core/contracts/server/verified-origin";
import { InMemoryOutbox } from "../../__tests__/support/events.fixture.js";
import { redirectMatcher } from "../../matcher.js";
import { InMemoryRedirectRepo } from "../../repo.memory.js";
import { createRedirect, type RedirectsWriteDeps } from "../../redirects.js";
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
  assert.deepEqual(config.errors.blocked, [RedirectValidationError, RedirectTargetNotAllowedError, RedirectLoopError, RedirectConflictError]);
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
