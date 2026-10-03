// Characterization assertions copied and generalized from assistant/__tests__/tool-catalog-audit.test.ts
import assert from "node:assert/strict";
import { test } from "vitest";

import { createInMemoryToolAttemptAuditSink } from "./audit-fixture.js";
import type { ToolAttemptAuditSink } from "../tool-audit.js";
import {
  appendToolCatalogAttempt,
  describeToolAuditDetail,
  DESCRIBE_TOOL_TOOL_ID,
  searchToolsAuditDetail,
  SEARCH_TOOLS_TOOL_ID,
  withToolCatalogAudit,
} from "./catalog-fixture.js";
import { buildToolCatalogQuery } from "./catalog-fixture.js";

function recorded<T>(items: readonly T[], index: number): T {
  const item = items[index];
  assert.ok(item !== undefined, `Expected recorded item ${index}`);
  return item;
}

const WORKSPACE_ID = "ws-catalog-audit";
const RUN_ID = "run-catalog-audit";
const PRINCIPAL_ID = "principal-catalog-audit";

const DESCRIPTORS = [
  { id: "forms_create_definition", description: "Creates a new form definition from a name, a URL slug, and fields." },
  { id: "forms_update_definition", description: "Updates an existing form definition's name, field list, or notify config." },
  { id: "identity_user_create", description: "Creates a new human operator user." },
];

function fakeRegistry() {
  return { list: () => DESCRIPTORS };
}

function wrap(sink: ToolAttemptAuditSink) {
  let sequence = 0;
  return withToolCatalogAudit(
    buildToolCatalogQuery(fakeRegistry(), { includeSearchKeywords: false }),
    sink,
    { workspaceId: WORKSPACE_ID, runId: RUN_ID, principalId: PRINCIPAL_ID },
    { now: () => `2026-09-01T00:00:0${sequence++}.000Z`, newAttemptId: () => "attempt-catalog-1" },
  );
}

test("INCIDENT FIX: a search_tools call is durably recorded with its query length, limit, and ranked hit ids — never the raw query text", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  const catalog = wrap(sink);

  const hits = catalog.search("form definition", 5);

  assert.deepEqual(hits.map((h) => h.id).sort(), ["forms_create_definition", "forms_update_definition"]);

  await Promise.resolve(); // let the fire-and-forget append settle
  assert.equal(sink.events.length, 1);
  const event = recorded(sink.events, 0);
  assert.equal(event.toolId, SEARCH_TOOLS_TOOL_ID);
  assert.equal(event.phase, "completed");
  assert.equal(event.workspaceId, WORKSPACE_ID);
  assert.equal(event.runId, RUN_ID);
  assert.equal(event.principalId, PRINCIPAL_ID);
  assert.equal(event.executionId, null);
  assert.deepEqual(JSON.parse(String(event.detail)), {
    queryLength: "form definition".length,
    limit: 5,
    resultIds: hits.map((h) => h.id),
    resultCount: hits.length,
  });
});

test("a search_tools call that matches nothing still records the query length and limit, with an empty resultIds array", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  const catalog = wrap(sink);

  const hits = catalog.search("zzzzqqqwwwnothingmatchesthis", 10);

  assert.deepEqual(hits, []);
  await Promise.resolve();
  assert.deepEqual(JSON.parse(String(recorded(sink.events, 0).detail)), { queryLength: "zzzzqqqwwwnothingmatchesthis".length, limit: 10, resultIds: [], resultCount: 0 });
});

test("SECURITY: a search query containing a credential-shaped string is never stored verbatim in the durable audit detail — only its length", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  const catalog = wrap(sink);

  const secretQuery = "does sk-ant-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 still work";
  catalog.search(secretQuery, 5);

  await Promise.resolve();
  const detail = String(recorded(sink.events, 0).detail);
  assert.equal(detail.includes("sk-ant-"), false, "the raw query text — and any secret it carries — must never enter the durable audit detail");
  assert.deepEqual(JSON.parse(detail), { queryLength: secretQuery.length, limit: 5, resultIds: [], resultCount: 0 });
});

test("a describe_tool call records the requested id and whether it resolved", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  const catalog = wrap(sink);

  const found = catalog.describe("forms_create_definition");
  const missing = catalog.describe("nonexistent_tool");

  assert.ok(found);
  assert.equal(missing, null);
  await Promise.resolve();
  assert.equal(sink.events.length, 2);
  assert.equal(recorded(sink.events, 0).toolId, DESCRIBE_TOOL_TOOL_ID);
  assert.deepEqual(JSON.parse(String(recorded(sink.events, 0).detail)), { id: "forms_create_definition", found: true });
  assert.deepEqual(JSON.parse(String(recorded(sink.events, 1).detail)), { id: "nonexistent_tool", found: false });
});

test("ADVERSARIAL: a sink that throws cannot break a search or describe call — audit is observation, not a gate", async () => {
  const errors: unknown[] = [];
  const hostileSink: ToolAttemptAuditSink = {
    append: async () => {
      throw new Error("disk full");
    },
  };
  const catalog = withToolCatalogAudit(
    buildToolCatalogQuery(fakeRegistry()),
    hostileSink,
    { workspaceId: WORKSPACE_ID, runId: RUN_ID, principalId: PRINCIPAL_ID },
    { onSinkError: (e) => errors.push(e) },
  );

  const hits = catalog.search("form", 5);
  const entry = catalog.describe("forms_create_definition");

  assert.ok(hits.length > 0);
  assert.ok(entry);
  await Promise.resolve();
  assert.equal(errors.length, 2, "both appends failed and both were reported — loud, but not fatal");
});

test("searchToolsAuditDetail/describeToolAuditDetail are pure JSON builders", () => {
  assert.equal(searchToolsAuditDetail("q", 10, [{ id: "a", description: "", source: "s", score: 1 }]), JSON.stringify({ queryLength: 1, limit: 10, resultIds: ["a"], resultCount: 1 }));
  assert.equal(describeToolAuditDetail("a", null), JSON.stringify({ id: "a", found: false }));
});

test("appendToolCatalogAttempt appends exactly the fields it is given, plus a minted attemptId/executionId/phase/at", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  appendToolCatalogAttempt(
    sink,
    { workspaceId: WORKSPACE_ID, runId: RUN_ID, principalId: PRINCIPAL_ID, toolId: SEARCH_TOOLS_TOOL_ID, detail: "d" },
    { now: () => "2026-09-01T00:00:00.000Z", newAttemptId: () => "attempt-x" },
  );
  await Promise.resolve();
  assert.deepEqual(recorded(sink.events, 0), {
    attemptId: "attempt-x",
    executionId: null,
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    toolId: SEARCH_TOOLS_TOOL_ID,
    principalId: PRINCIPAL_ID,
    phase: "completed",
    at: "2026-09-01T00:00:00.000Z",
    detail: "d",
  });
});
