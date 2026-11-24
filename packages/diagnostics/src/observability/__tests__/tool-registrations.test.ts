import assert from "node:assert/strict";
import { test } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { buildObservabilityRegistrations, contributeObservabilityTools, createObservabilityAgentToolCatalog, observabilityDerivedRisk } from "../tool-registrations.js";

const context = (input: unknown, signal = new AbortController().signal): ToolExecutionContext => ({ executionId: "test", principal: { id: "admin" }, run: { id: "run" }, input, signal });
const testErrorMessage = "Example test error — safe to ignore";

test("diagnostic tool requires admin permission, runs directly, and shares the injected action", async () => {
  const authorization: unknown[] = [];
  const sent: unknown[] = [];
  const result = { providers: [{ providerId: "errors", signals: ["error" as const] }] };
  const [registration] = buildObservabilityRegistrations({ workspaceId: "site", testErrorMessage, authorize: async input => {
    authorization.push(input); return { allowed: true, reason: "matched" };
  }, sendTelemetryTest: async input => { sent.push(input); return result; } });
  assert.equal(registration!.descriptor.id, "observability_send_test_error");
  assert.deepEqual(registration!.descriptor.metadata?.approval, { class: "edit", confirmation: "direct" });
  assert.deepEqual(await registration!.handler(context({})), result);
  assert.deepEqual(sent, [{}]);
  assert.deepEqual(authorization, [{ principalId: "admin", workspaceId: "site", permission: "system.write", entityType: "observability" }]);
});

test("diagnostic tool refuses extra arguments and denied callers without sending", async () => {
  let sent = 0;
  const [registration] = buildObservabilityRegistrations({ workspaceId: "site", testErrorMessage, authorize: async () => ({ allowed: false, reason: "insufficient_permission" }),
    sendTelemetryTest: async () => { sent++; return { providers: [] }; } });
  await assert.rejects(() => registration!.handler(context({ error: "untrusted error" })), { message: "observability_send_test_error takes no arguments." });
  await assert.rejects(() => registration!.handler(context({})), { message: "OBSERVABILITY_FORBIDDEN: principal 'admin' is not authorized for 'system.write' (insufficient_permission)" });
  assert.equal(sent, 0);
});

test("omitted input is accepted; a missing action and an aborted run never send", async () => {
  const allow = async () => ({ allowed: true, reason: "matched" });
  const [unavailable] = buildObservabilityRegistrations({ workspaceId: "site", testErrorMessage, authorize: allow });
  await assert.rejects(() => unavailable!.handler(context(undefined)), { message: "Telemetry test is unavailable on this server." });
  let sent = 0;
  const [registration] = buildObservabilityRegistrations({ workspaceId: "site", testErrorMessage, authorize: allow, sendTelemetryTest: async () => { sent++; return { providers: [] }; } });
  const aborted = new AbortController();
  aborted.abort(new Error("run cancelled"));
  await assert.rejects(() => registration!.handler(context(undefined, aborted.signal)), { message: "run cancelled" });
  assert.equal(sent, 0);
  assert.deepEqual(await registration!.handler(context(undefined)), { providers: [] });
});

test("the description names the host-supplied test error message verbatim", () => {
  const [entry] = createObservabilityAgentToolCatalog({ testErrorMessage });
  assert.equal(entry!.description, "Send the fixed diagnostic 'Example test error — safe to ignore', one test span and one telemetry_test analytics event through this site's tracker. Requires admin system.write. No confirmation needed. Returns provider ids and signals accepted locally; this is not proof of remote delivery. Analytics still requires telemetry consent. Takes no arguments.");
});

test("the contributor publishes the message it was given and the derived risk", () => {
  const contributor = contributeObservabilityTools({ testErrorMessage: "Other host message" });
  assert.equal(contributor.domain, "observability");
  assert.equal(contributor.risk, observabilityDerivedRisk);
  const [registration] = contributor.build({ workspaceId: "site", authorize: async () => ({ allowed: true, reason: "matched" }) }, {});
  assert.match(registration!.descriptor.description ?? "", /^Send the fixed diagnostic 'Other host message', one test span/);
});
