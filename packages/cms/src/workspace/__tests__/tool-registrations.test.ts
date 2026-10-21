import assert from "node:assert/strict";
import { test } from "vitest";

import { ToolInputError, ToolPermissionDeniedError, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";

import type { AuthorizeFn } from "../../core/commands/command.js";
import { getWorkspaceAgentToolCatalog } from "../agent-tools.js";
import { WorkspaceConflictError, WorkspaceValidationError, type WorkspaceRecord } from "../create.js";
import * as workspaceBarrel from "../index.js";
import { InMemoryWorkspaceRepo } from "../repo.memory.js";
import { buildWorkspaceRegistrations, workspaceDerivedRisk, type WorkspaceToolDeps } from "../tool-registrations.js";

/**
 * @file Agent-tool surface of the Workspace domain: the catalog (`agent-tools.ts`), the wiring
 * (`tool-registrations.ts`) and the barrel (`index.ts`). The highest-stakes property here is the
 * exclusion of `workspace_create`/`workspace_delete` — an agent must never see or call them.
 */

const WORKSPACE_ID = "ws-boot-wired";
const PRINCIPAL_ID = "principal-under-test";
const SEED: WorkspaceRecord = { id: WORKSPACE_ID, name: "Main Site", slug: "main-site", createdAt: "2026-01-01T00:00:00.000Z" };
const OTHER: WorkspaceRecord = { id: "ws-other", name: "Other", slug: "taken", createdAt: "2026-01-02T00:00:00.000Z" };

type AuthorizeCall = Parameters<AuthorizeFn>[0];

function executionContext(input: unknown): ToolExecutionContext {
  return { executionId: "exec-1", principal: { id: PRINCIPAL_ID }, run: { id: "run-1" }, input, signal: new AbortController().signal } as ToolExecutionContext;
}

/** Hand-written deps: a real in-memory repo plus an authorize fake that records each request. */
function fakeDeps({ allowed = true, rows = [SEED, OTHER] }: { allowed?: boolean; rows?: WorkspaceRecord[] } = {}): {
  deps: WorkspaceToolDeps;
  repo: InMemoryWorkspaceRepo;
  calls: AuthorizeCall[];
} {
  const calls: AuthorizeCall[] = [];
  const repo = new InMemoryWorkspaceRepo({}, { initialRows: rows });
  const authorize: AuthorizeFn = async (request) => {
    calls.push(request);
    return allowed ? { allowed: true, reason: "matched" } : { allowed: false, reason: "no grant" };
  };
  return { deps: { authorize, workspaceId: WORKSPACE_ID, workspaceRepo: repo }, repo, calls };
}

function registrationFor({ deps, toolId }: { deps: WorkspaceToolDeps; toolId: string }): ToolRegistration {
  const registration = buildWorkspaceRegistrations(deps).find((candidate) => candidate.descriptor.id === toolId);
  assert.ok(registration, `${toolId} must be wired`);
  return registration;
}

test("the catalog declares get/update with schemas and create/delete as schema-less, excluded entries", () => {
  const catalog = getWorkspaceAgentToolCatalog();
  assert.deepEqual(catalog.map((entry) => [entry.name, entry.sideEffects, entry.authorization]), [
    ["workspace_get", "none", { permission: "workspace.manage" }],
    ["workspace_update", "mutates-durable-state", { permission: "workspace.manage" }],
    ["workspace_create", "mutates-durable-state", { permission: "workspace.manage" }],
    ["workspace_delete", "mutates-durable-state", { permission: "workspace.manage" }],
  ]);
  const byName = new Map(catalog.map((entry) => [entry.name, entry]));
  assert.deepEqual(byName.get("workspace_get")?.inputSchema, { type: "object", additionalProperties: false, required: [], properties: {} });
  assert.deepEqual(Object.keys(byName.get("workspace_update")?.inputSchema?.["properties"] as object), ["name", "slug"]);
  assert.equal(byName.get("workspace_create")?.inputSchema, undefined);
  assert.equal(byName.get("workspace_delete")?.inputSchema, undefined);
  assert.notEqual(getWorkspaceAgentToolCatalog(), catalog, "each call returns a fresh array a caller may not mutate shared state through");
});

test("only the read and the rename are wired; create and delete never become registrations", () => {
  const { deps } = fakeDeps();
  const registrations = buildWorkspaceRegistrations(deps);
  assert.deepEqual(registrations.map((r) => [r.descriptor.id, r.descriptor.readOnly]), [
    ["workspace_get", true],
    ["workspace_update", false],
  ]);
  assert.deepEqual([...workspaceDerivedRisk.entries()], [
    ["workspace_get", "none"],
    ["workspace_update", "mutates-durable-state"],
  ]);
});

test("workspace_get returns the boot-wired workspace after a workspace.manage check scoped to the workspace entity", async () => {
  const { deps, calls } = fakeDeps();
  const get = registrationFor({ deps, toolId: "workspace_get" });

  assert.deepEqual(await get.handler(executionContext(undefined)), { workspace: SEED });
  assert.deepEqual(await get.handler(executionContext({})), { workspace: SEED });
  assert.deepEqual(calls[0], { principalId: PRINCIPAL_ID, permission: "workspace.manage", workspaceId: WORKSPACE_ID, entityType: "workspace" });
  assert.equal(calls.length, 2);
});

test("workspace_get refuses any input before consulting authorization", async () => {
  const { deps, calls } = fakeDeps();
  const get = registrationFor({ deps, toolId: "workspace_get" });
  await assert.rejects(() => get.handler(executionContext({ id: "ws-other" })), ToolInputError);
  assert.equal(calls.length, 0);
});

test("workspace_get surfaces a denial as ToolPermissionDeniedError without reading the row", async () => {
  const { deps, repo } = fakeDeps({ allowed: false });
  let reads = 0;
  const findById = repo.findById.bind(repo);
  repo.findById = async (required) => { reads += 1; return findById(required); };
  const get = registrationFor({ deps, toolId: "workspace_get" });
  await assert.rejects(() => get.handler(executionContext({})), (error: unknown) => {
    assert.ok(error instanceof ToolPermissionDeniedError);
    assert.match(error.message, /not authorized for 'workspace\.manage' \(no grant\)/);
    return true;
  });
  assert.equal(reads, 0);
});

test("workspace_get fails loudly when the boot-wired workspace row is missing", async () => {
  const { deps } = fakeDeps({ rows: [OTHER] });
  const get = registrationFor({ deps, toolId: "workspace_get" });
  await assert.rejects(() => get.handler(executionContext({})), { message: `workspace '${WORKSPACE_ID}' was not found` });
});

test("workspace_update renames only the boot-wired workspace and persists the normalized values", async () => {
  const { deps, repo, calls } = fakeDeps();
  const update = registrationFor({ deps, toolId: "workspace_update" });

  const result = await update.handler(executionContext({ name: "  Renamed  ", slug: "Renamed-Site" }));
  const expected = { ...SEED, name: "Renamed", slug: "renamed-site" };
  assert.deepEqual(result, { workspace: expected });
  assert.deepEqual(await repo.findById({ id: WORKSPACE_ID }), expected);
  assert.deepEqual(await repo.findById({ id: OTHER.id }), OTHER, "the other row is untouched");
  assert.deepEqual(calls, [{ principalId: PRINCIPAL_ID, permission: "workspace.manage", workspaceId: WORKSPACE_ID, entityType: "workspace" }]);
});

test("workspace_update accepts a slug-only change and keeps the existing name", async () => {
  const { deps } = fakeDeps();
  const update = registrationFor({ deps, toolId: "workspace_update" });
  assert.deepEqual(await update.handler(executionContext({ slug: "fresh" })), { workspace: { ...SEED, slug: "fresh" } });
});

test("workspace_update propagates typed domain errors for empty, invalid and conflicting updates", async () => {
  const { deps, repo } = fakeDeps();
  const update = registrationFor({ deps, toolId: "workspace_update" });
  await assert.rejects(() => update.handler(executionContext({})), WorkspaceValidationError);
  await assert.rejects(() => update.handler(executionContext({ slug: "bad slug" })), WorkspaceValidationError);
  await assert.rejects(() => update.handler(executionContext({ slug: OTHER.slug })), WorkspaceConflictError);
  assert.deepEqual(await repo.findById({ id: WORKSPACE_ID }), SEED);
});

test("workspace_update rejects non-object input and non-string fields before authorizing", async () => {
  const { deps, calls } = fakeDeps();
  const update = registrationFor({ deps, toolId: "workspace_update" });
  await assert.rejects(() => update.handler(executionContext("rename")), ToolInputError);
  assert.equal(calls.length, 0);
  await assert.rejects(() => update.handler(executionContext({ name: 42 })), { message: "'name' must be a string" });
});

test("workspace_update denied by authorization leaves the row unchanged", async () => {
  const { deps, repo } = fakeDeps({ allowed: false });
  const update = registrationFor({ deps, toolId: "workspace_update" });
  await assert.rejects(() => update.handler(executionContext({ name: "Hijacked" })), ToolPermissionDeniedError);
  assert.deepEqual(await repo.findById({ id: WORKSPACE_ID }), SEED);
});

test("the barrel publishes the domain's functions, errors and adapters as the same bindings", async () => {
  const create = await import("../create.js");
  const update = await import("../update.js");
  const remove = await import("../delete.js");
  assert.equal(workspaceBarrel.createWorkspace, create.createWorkspace);
  assert.equal(workspaceBarrel.validateWorkspaceNameAndSlug, create.validateWorkspaceNameAndSlug);
  assert.equal(workspaceBarrel.WorkspaceConflictError, create.WorkspaceConflictError);
  assert.equal(workspaceBarrel.WorkspaceLastRemainingError, create.WorkspaceLastRemainingError);
  assert.equal(workspaceBarrel.WorkspaceNotFoundError, create.WorkspaceNotFoundError);
  assert.equal(workspaceBarrel.WorkspaceValidationError, create.WorkspaceValidationError);
  assert.equal(workspaceBarrel.updateWorkspace, update.updateWorkspace);
  assert.equal(workspaceBarrel.deleteWorkspace, remove.deleteWorkspace);
  assert.equal(workspaceBarrel.InMemoryWorkspaceRepo, InMemoryWorkspaceRepo);
  assert.equal(workspaceBarrel.getWorkspaceAgentToolCatalog, getWorkspaceAgentToolCatalog);
  assert.equal(workspaceBarrel.buildWorkspaceRegistrations, buildWorkspaceRegistrations);
  assert.equal(workspaceBarrel.workspaceDerivedRisk, workspaceDerivedRisk);
  assert.equal("SqliteWorkspaceRepo" in workspaceBarrel, false, "no host-schema adapter on the public contract");
});
