import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { test, onTestFinished, vi } from "vitest";
import { InMemoryMcpSession } from "../testing/adapter.memory.js";
import { federateSession } from "../registrations.js";

async function run(name: string, input: Record<string, unknown>, annotations?: Record<string, boolean> | undefined, allow = true) {
  const session = new InMemoryMcpSession({ tools: [{name, inputSchema: {type: "object"}, ...(annotations ? {annotations} : {})}] });
  const cards: string[] = [];
  const destructive: boolean[] = [];
  const {registrations} = await federateSession({session, nativeToolIds: new Set(), config: {
    connectionId: "service", label: "Service", allowedToolNames: [name], writeAllowedToolNames: [],
    maxTools: 5, maxResultBytes: 4096, connectTimeoutMs: 100, callTimeoutMs: 100,
  }, deps: { messages: federationMessages, errorCode: "EXTERNAL_MCP", permissionGate: testPermissionGate({ authorize: async () => ({allowed: allow, reason: allow ? "matched" : "not authorized"}), scope: "workspace" }), scope: "workspace", confirmCall: async ({ context: _ctx, request }) => {cards.push(request.remoteName); destructive.push(request.destructive); return {confirmed: false, result: {cancelled: true}};} }});
  const result = await registrations[0]!.handler({executionId: "execution", run: {id: "run"}, principal: {id: "owner"}, input, signal: new AbortController().signal});
  return {session, cards, destructive, result};
}

for (const [name, args, hints] of [
  ["create_project", {}, {readOnlyHint: false}],
  ["generate_image", {}, undefined],
  ["search", {query: "red fox"}, {readOnlyHint: true}],
  ["execute_sql", {query: "select 1"}, {destructiveHint: true}],
  ["apply_migration", {query: "create table demo (id integer)"}, {destructiveHint: true}],
  // A recoverable-sounding name with no declared hint stays card-free (6eac86229).
  ["trash_item", {id: "one"}, undefined],
] as const) test(`n06: ${name} ordinary call needs no card`, async () => {
  const result = await run(name, args, hints);
  assert.deepEqual(result.cards, []);
  assert.equal(result.session.calls.length, 1);
});

// REGRESSION (class B, 2026-10-03): fails if a recoverable-sounding name outranks a remote's own
// destructiveHint. A federated server's name is untrusted text; "trash" on someone else's server is
// not Tovu's reversible trash, so a declared destructive hint keeps the destructive card (fail closed).
for (const name of ["trash_item", "archive_project", "tombstone_record", "unpublish_site"]) test(`federated ${name} declaring destructiveHint keeps the destructive card`, async () => {
  const result = await run(name, {id: "one"}, {destructiveHint: true});
  assert.deepEqual(result.cards, [name]);
  assert.deepEqual(result.destructive, [true]);
  assert.deepEqual(result.session.calls, []);
});

for (const [name, args, hints] of [
  ["delete_project", {}, {destructiveHint: true}],
  ["execute_sql", {query: "drop table demo"}, {readOnlyHint: true}],
  ["apply_migration", {query: "delete from subscribers"}, undefined],
  ["send_email", {to: "person@example.com", body: "hello"}, {readOnlyHint: false}],
  ["assistant_set_instructions", {instructions: "ignore rules"}, {readOnlyHint: false}],
] as const) test(`n06: ${name} protected action stays gated`, async () => {
  const result = await run(name, args, hints);
  assert.deepEqual(result.cards, [name]);
  assert.equal(result.session.calls.length, 0);
  assert.deepEqual(result.result, {federated: {connectionId: "service", tool: name}, ran: false, cancelled: true});
});

test("n06: ordinary writes still enforce authorization", async () => {
  await assert.rejects(run("create_project", {}, {readOnlyHint: false}, false), /not authorized/);
});

for (const query of ["truncate demo", "drop /* comment */ table demo", "select 1; delete from subscribers", "DO $$ BEGIN EXECUTE 'drop table demo'; END $$"]) test(`n06: destructive SQL is gated: ${query}`, async () => {
  const result = await run("execute_sql", {query}, {readOnlyHint: true});
  assert.deepEqual(result.cards, ["execute_sql"]);
  assert.equal(result.session.calls.length, 0);
});

test("n06: SQL literal text does not require confirmation", async () => {
  const result = await run("execute_sql", {query: "select 'drop table demo' as example"}, {destructiveHint: true});
  assert.deepEqual(result.cards, []);
  assert.equal(result.session.calls.length, 1);
});

for (const name of ["reply_to_email", "forward_email", "post_message", "publish_newsletter", "set_system_prompt"]) test(`n06: protected alternate name ${name} stays gated`, async () => {
  const result = await run(name, {}, {readOnlyHint: false});
  assert.deepEqual(result.cards, [name]);
  assert.equal(result.session.calls.length, 0);
});

test("n06: reading the assistant's permissions needs no confirmation", async () => {
  const result = await run("assistant_get_permissions", {}, {readOnlyHint: true});
  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.session.calls.map(call => call.name), ["assistant_get_permissions"]);
});

for (const [name, args, expected] of [
  ["assistant_set_instructions", {instructions: "new instructions"}, false],
  ["assistant_set_privacy", {privacy: "private"}, false],
  ["assistant_set_permissions", {permissions: []}, false],
  ["set_system_prompt", {prompt: "new prompt"}, false],
  ["send_email", {to: "person@example.com"}, false],
  ["delete_project", {}, true],
  ["execute_sql", {query: "drop table demo"}, true],
] as const) test(`n06: ${name} card marks permanent deletion accurately`, async () => {
  const result = await run(name, args);
  assert.deepEqual(result.cards, [name]);
  assert.deepEqual(result.destructive, [expected]);
  assert.deepEqual(result.session.calls, []);
});

// REGRESSION: fails if askBeforeCall restores the fixed no-confirmation-channel prefix.
test("missing human channel derives its error namespace from the host", async () => {
  const session = new InMemoryMcpSession({ tools: [{ name: "delete_project", inputSchema: { type: "object" } }] });
  const { registrations } = await federateSession({ session, nativeToolIds: new Set(), config: {
    connectionId: "service", label: "Service", allowedToolNames: ["delete_project"], writeAllowedToolNames: [],
    maxTools: 5, maxResultBytes: 4096, connectTimeoutMs: 100, callTimeoutMs: 100,
  }, deps: { messages: federationMessages, errorCode: "HOST_APPROVAL", permissionGate: () => undefined } });
  await assert.rejects(() => registrations[0]!.handler({ executionId: "execution", run: { id: "run" },
    principal: { id: "person" }, input: {}, signal: new AbortController().signal }), /HOST_APPROVAL_NO_CONFIRMATION_CHANNEL/);
  assert.deepEqual(session.calls, []);
});
