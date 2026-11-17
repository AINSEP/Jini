import assert from "node:assert/strict";
import { test } from "vitest";

import { ToolInputError, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";
import { createVerifiedOrigin, InMemoryOriginSettingRepo, OriginRegistry } from "@jini-ai/core/contracts/server/verified-origin";
import { buildRedirectsToolRegistrations, redirectsDerivedRisk, type RedirectsPackageToolDeps } from "../tool-registrations.js";
import { getRedirectsAgentToolCatalog } from "../agent-tools.js";
import { redirectMatcher } from "../matcher.js";
import type { RedirectDbHandle } from "../ports.internal.js";
import { InMemoryRedirectRepo } from "../repo.memory.js";
import { createRedirect, updateRedirect, type RedirectsWriteDeps } from "../redirects.js";
import { InMemoryOutbox } from "./support/events.fixture.js";
import { removeVia, restoreVia } from "./remove-redirect-double.js";

/**
 * @file The redirects tool registrations over in-memory fakes of their ports: the catalog's ids and
 * flags, the authored risk map, the permission refusal and the model-facing error text of every
 * tool, one success view per tool, the Trash exclusion of `redirects_list`, and the per-rule failure
 * redaction of `redirects_import`. Host metadata is deliberately absent from these registrations:
 * a host binds it around them.
 */

const WORKSPACE_ID = "ws-redirects-tools";
const PRINCIPAL_ID = "principal-under-test";
const NOW = "2026-07-29T00:00:00.000Z";
const INTERNAL_DETAIL = "SQLITE_IOERR: disk I/O error at /var/data/site.db";

const TOOL_IDS = ["redirects_list", "redirects_get", "redirects_get_hits", "redirects_create", "redirects_update", "redirects_tombstone", "redirects_import"] as const;

interface Fixture {
  deps: RedirectsPackageToolDeps;
  redirectRepo: InMemoryRedirectRepo;
  trashedIds: Set<string>;
}

function makeFixture(options: { allow?: boolean } = {}): Fixture {
  const allow = options.allow ?? true;
  const redirectRepo = new InMemoryRedirectRepo();
  const trashedIds = new Set<string>();
  const originRepo = new InMemoryOriginSettingRepo({ seeds: [
    { workspaceId: WORKSPACE_ID, origin: createVerifiedOrigin({ scheme: "https", host: "trusted.example", verifiedAt: NOW, source: "workspace-setting" }), redirectAllowlist: [] },
  ] });
  let clockTick = 0;
  let idTick = 0;
  const redirectsWriteDeps: RedirectsWriteDeps = {
    repo: redirectRepo,
    remove: removeVia(redirectRepo as unknown as Parameters<typeof removeVia>[0]),
    isInTrash: async ({ id }) => trashedIds.has(id),
    restore: restoreVia(redirectRepo as unknown as Parameters<typeof removeVia>[0]),
    db: redirectRepo as unknown as RedirectDbHandle,
    transaction: async (fn) => fn(),
    reservedSegments: new Set(["admin", "api"]),
    matcher: redirectMatcher,
    originRegistry: new OriginRegistry({ repo: originRepo }),
    clock: {
      nowMs: () => {
        const second = clockTick;
        clockTick += 1;
        return Date.parse(`2026-07-29T00:00:${String(second).padStart(2, "0")}.000Z`);
      },
    },
    idGen: {
      newId: () => {
        idTick += 1;
        return `redirect-${idTick}`;
      },
    },
    outbox: new InMemoryOutbox(),
  };
  const deps: RedirectsPackageToolDeps = {
    workspaceId: WORKSPACE_ID,
    redirectRepo,
    redirectHitSink: { record: async () => undefined, getStats: async () => null, listStats: async () => [] },
    redirectsWriteDeps,
    authorize: async () => (allow ? { allowed: true, reason: "matched" } : { allowed: false, reason: "insufficient_permission" }),
  };
  return { deps, redirectRepo, trashedIds };
}

function handler(deps: RedirectsPackageToolDeps, toolId: string): ToolRegistration["handler"] {
  const registration = buildRedirectsToolRegistrations({ deps }).find((r) => r.descriptor.id === toolId);
  assert.ok(registration, `expected ${toolId} to be wired`);
  return registration.handler;
}

function ctx(input: unknown): ToolExecutionContext {
  return { executionId: "exec-1", principal: { id: PRINCIPAL_ID }, run: { id: "run-1" }, input, signal: new AbortController().signal };
}

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof ToolInputError, `expected ToolInputError, got ${(err as Error)?.constructor?.name}: ${(err as Error)?.message}`);
    return err.message;
  }
  return assert.fail("expected the handler to reject");
}

const create = (deps: RedirectsPackageToolDeps, fromPattern: string, toTarget: string) =>
  handler(deps, "redirects_create")(ctx({ matchType: "exact", fromPattern, toTarget, statusCode: 301 }));

test("the registrations are the seven catalog tools, in catalog order, without host metadata", () => {
  const registrations = buildRedirectsToolRegistrations({ deps: makeFixture().deps });
  assert.deepEqual(registrations.map((r) => r.descriptor.id), [...TOOL_IDS]);
  assert.deepEqual(getRedirectsAgentToolCatalog().map((entry) => entry.name), [...TOOL_IDS]);
  for (const registration of registrations) assert.equal(registration.descriptor.metadata, undefined, registration.descriptor.id);
});

test("the derived-risk map classifies the three reads as none and the four writes as durable", () => {
  assert.deepEqual([...redirectsDerivedRisk.entries()], [
    ["redirects_list", "none"],
    ["redirects_get", "none"],
    ["redirects_get_hits", "none"],
    ["redirects_create", "mutates-durable-state"],
    ["redirects_update", "mutates-durable-state"],
    ["redirects_tombstone", "mutates-durable-state"],
    ["redirects_import", "mutates-durable-state"],
  ]);
});

for (const toolId of TOOL_IDS) {
  test(`${toolId}: a principal without the permission is refused with REDIRECTS_FORBIDDEN`, async () => {
    const { deps } = makeFixture({ allow: false });
    assert.equal(
      await rejectionMessage(handler(deps, toolId)(ctx({ id: "r1", rules: [] }))),
      "REDIRECTS_FORBIDDEN: principal 'principal-under-test' is not authorized for 'admin.redirects.manage' (insufficient_permission)",
    );
  });
}

for (const toolId of ["redirects_get", "redirects_get_hits", "redirects_update", "redirects_tombstone"]) {
  test(`${toolId}: an unknown id tells the model REDIRECTS_NOT_FOUND, not a redacted internal error`, async () => {
    const { deps } = makeFixture();
    const input = toolId === "redirects_update" ? { id: "nope", priority: 3 } : { id: "nope" };
    assert.equal(await rejectionMessage(handler(deps, toolId)(ctx(input))), "REDIRECTS_NOT_FOUND: redirect 'nope' was not found");
  });
}

test("redirects_create: an invalid pattern is REDIRECTS_VALIDATION with the chokepoint's own reason", async () => {
  const { deps } = makeFixture();
  assert.equal(
    await rejectionMessage(handler(deps, "redirects_create")(ctx({ matchType: "regex", fromPattern: "/a.*", toTarget: "/b", statusCode: 301 }))),
    "REDIRECTS_VALIDATION: matchType 'regex' is not enabled in v1",
  );
});

test("redirects_create: an off-site target is REDIRECTS_TARGET_NOT_ALLOWED", async () => {
  const { deps } = makeFixture();
  assert.equal(
    await rejectionMessage(create(deps, "/old", "https://evil.example/x")),
    "REDIRECTS_TARGET_NOT_ALLOWED: toTarget 'https://evil.example/x' is not an allowed redirect destination",
  );
});

test("redirects_create: a duplicate active rule is REDIRECTS_CONFLICT", async () => {
  const { deps } = makeFixture();
  await create(deps, "/dup", "/one");
  assert.equal(await rejectionMessage(create(deps, "/dup", "/two")), "REDIRECTS_CONFLICT: an active exact rule for '/dup' already exists");
});

test("redirects_create: a cycle is REDIRECTS_LOOP naming the rule that would close it", async () => {
  const { deps } = makeFixture();
  await create(deps, "/b", "/a");
  assert.equal(
    await rejectionMessage(create(deps, "/a", "/b")),
    "REDIRECTS_LOOP: redirect from '/a' would create a cycle via '/b' (resolves back to '/a')",
  );
});

test("an unlisted infrastructure error stays redacted (not reclassified as a ToolInputError)", async () => {
  const { deps, redirectRepo } = makeFixture();
  redirectRepo.list = async () => {
    throw new Error(INTERNAL_DETAIL);
  };
  await assert.rejects(handler(deps, "redirects_list")(ctx({})), (err: unknown) => {
    assert.ok(!(err instanceof ToolInputError), "an unknown error must stay `internal` so the transport redacts it");
    return true;
  });
});

test("one success call per tool returns the model-facing view", async () => {
  const fixture = makeFixture();
  const call = (id: string, input: unknown) => handler(fixture.deps, id)(ctx(input));
  const created = (await call("redirects_create", { matchType: "exact", fromPattern: "/old", toTarget: "/new", statusCode: 301 })) as { rule: Record<string, unknown> };
  const expectedView = {
    id: "redirect-1", matchType: "exact", fromPattern: "/old", toTarget: "/new", statusCode: 301, status: "active", override: false, priority: 0,
    source: "manual", createdAt: created.rule.createdAt, updatedAt: created.rule.updatedAt, version: 1,
  };
  assert.deepEqual(created, { rule: expectedView });
  assert.deepEqual(await call("redirects_list", {}), { rules: [expectedView] });
  assert.deepEqual(await call("redirects_get", { id: "redirect-1" }), { rule: expectedView });
  assert.deepEqual(await call("redirects_get_hits", { id: "redirect-1" }), { stats: { redirectId: "redirect-1", workspaceId: WORKSPACE_ID, hitCount: 0, lastHitAt: undefined } });
  const updated = (await call("redirects_update", { id: "redirect-1", priority: 5 })) as { rule: { priority: number; version: number } };
  assert.equal(updated.rule.priority, 5);
  assert.equal(updated.rule.version, 2);
  const imported = (await call("redirects_import", { rules: [{ matchType: "exact", fromPattern: "/a", toTarget: "/b", statusCode: 302 }] })) as { created: unknown[]; failed: unknown[] };
  assert.equal(imported.created.length, 1);
  assert.deepEqual(imported.failed, []);
  const tombstoned = (await call("redirects_tombstone", { id: "redirect-1" })) as { tombstoned: boolean; cancelled: boolean; rule: unknown };
  assert.equal(tombstoned.tombstoned, true);
  assert.equal(tombstoned.cancelled, false);
  assert.ok(tombstoned.rule);
});

test("redirects_list leaves out a switched-off rule whose isInTrash is true", async () => {
  const fixture = makeFixture();
  const input = (fromPattern: string, toTarget: string) => ({ workspaceId: WORKSPACE_ID, matchType: "exact" as const, fromPattern, toTarget, statusCode: 301 as const, actorId: PRINCIPAL_ID });
  const { record: live } = await createRedirect({ deps: fixture.deps.redirectsWriteDeps, input: input("/live", "/live-target") });
  const { record: trashed } = await createRedirect({ deps: fixture.deps.redirectsWriteDeps, input: input("/gone", "/gone-target") });
  await updateRedirect({ deps: fixture.deps.redirectsWriteDeps, input: { workspaceId: WORKSPACE_ID, id: trashed.id, status: "disabled", actorId: PRINCIPAL_ID } });
  fixture.trashedIds.add(trashed.id);
  const listed = (await handler(fixture.deps, "redirects_list")(ctx({}))) as { rules: Array<{ id: string }> };
  assert.deepEqual(listed.rules.map((rule) => rule.id), [live.id]);
});

test("redirects_import: an infrastructure failure on one rule reports a fixed message, never the raw internal text", async () => {
  const { deps, redirectRepo } = makeFixture();
  const original = redirectRepo.findByFromPattern.bind(redirectRepo);
  redirectRepo.findByFromPattern = async (input) => {
    if (input.fromPattern === "/explode") throw new Error(INTERNAL_DETAIL);
    return original(input);
  };
  const result = (await handler(deps, "redirects_import")(ctx({
    rules: [
      { matchType: "exact", fromPattern: "/ok", toTarget: "/fine", statusCode: 301 },
      { matchType: "exact", fromPattern: "/bad", toTarget: "/explode", statusCode: 301 },
    ],
  }))) as { created: unknown[]; failed: Array<{ index: number; code: string; message: string }> };
  assert.equal(result.created.length, 1);
  assert.deepEqual(result.failed, [{ index: 1, code: "INTERNAL_ERROR", message: "an internal error occurred" }]);
});

test("redirects_import: a listed domain failure still reports its own actionable message", async () => {
  const { deps } = makeFixture();
  const result = (await handler(deps, "redirects_import")(ctx({
    rules: [{ matchType: "exact", fromPattern: "/x", toTarget: "https://evil.example/y", statusCode: 301 }],
  }))) as { failed: Array<{ index: number; code: string; message: string }> };
  assert.deepEqual(result.failed, [
    { index: 0, code: "REDIRECT_TARGET_NOT_ALLOWED", message: "toTarget 'https://evil.example/y' is not an allowed redirect destination" },
  ]);
});

test("redirects_list refuses an off-enum status, source or matchType naming the allowed values, before reading", async () => {
  const { deps, redirectRepo } = makeFixture();
  let listed = 0;
  redirectRepo.list = async () => {
    listed += 1;
    return [];
  };
  for (const [input, message] of [
    [{ status: "enabled" }, "'status' must be one of: active, disabled"],
    [{ source: "manual-ish" }, "'source' must be one of: manual, auto_slug_change, import"],
    [{ matchType: "glob" }, "'matchType' must be one of: exact, prefix, wildcard, regex"],
  ] as const) {
    assert.equal(await rejectionMessage(handler(deps, "redirects_list")(ctx(input))), message);
  }
  assert.equal(listed, 0);
  await handler(deps, "redirects_list")(ctx({ status: "disabled", source: "import", matchType: "regex" }));
  assert.equal(listed, 1);
});
