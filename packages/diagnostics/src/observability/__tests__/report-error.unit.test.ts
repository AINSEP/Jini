import assert from "node:assert/strict";
import { test } from "vitest";

import { createNoopObservabilityPort, type ErrorReport, type ObservabilityPort } from "../index.js";

import { combineObservabilityPorts } from "../fanout.js";
import { redactedError, reportErrorOnce, runWithErrorReportScope, type ErrorReportScope } from "../report-error.js";

/** @file `reportErrorOnce`: one redacted report per error object, marking the current request scope. */

function recording(): { port: ObservabilityPort; reports: ErrorReport[] } {
  const reports: ErrorReport[] = [];
  return { reports, port: { ...createNoopObservabilityPort({}), reportError: (report) => { reports.push(report); } } };
}

// Built at runtime so no secret-shaped literal sits in the repo.
const fakeSecret = () => ["sk", "live", "Q".repeat(12) + "z".repeat(12)].join("_");

test("an error object is reported once per occurrence, with its operation and attributes", () => {
  runWithErrorReportScope({ scope: { reported: false }, work: () => {
    const { port, reports } = recording();
    const failure = new Error("boom");
    assert.equal(reportErrorOnce({ observability: port, error: failure, operation: "site.publish" }, { attributes: { status: 500 } }), true);
    assert.equal(reportErrorOnce({ observability: port, error: failure, operation: "http.request" }), false);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.error, failure, "nothing to redact: the original error object is handed over");
    assert.deepEqual(reports[0]!.context, { operation: "site.publish", attributes: { status: 500 } });
  } });
});

test("versioned package stack frames retain the original error and complete stack", () => {
  const { port, reports } = recording();
  const failure = new Error("boom");
  failure.stack = "Error: boom\n    at run (/workspace/node_modules/.pnpm/vitest@4.0.1/node_modules/vitest/dist/runner.js:42:7)\n    at load (/workspace/pkg@1.2.3/index.js:8:2)";
  const stack = failure.stack;
  reportErrorOnce({ observability: port, error: failure, operation: "site.publish" });
  assert.equal(reports.length, 1);
  assert.equal(reports[0]!.error, failure);
  assert.equal((reports[0]!.error as Error).stack, stack);
});

test("message and stack are redacted before the port sees them", () => {
  const { port, reports } = recording();
  const secret = fakeSecret();
  reportErrorOnce({ observability: port, error: new TypeError(`upstream refused key ${secret}`), operation: "x" });
  const sent = reports[0]!.error as Error;
  assert.equal(sent.name, "TypeError");
  assert.ok(!sent.message.includes(secret) && !String(sent.stack).includes(secret));
  assert.match(sent.message, /REDACTED/);
});

test("non-Error throws become a redacted Error; no port means no report", () => {
  const secret = fakeSecret();
  assert.ok(!String((redactedError({ error: `token ${secret}` }) as Error).message).includes(secret));
  assert.match((redactedError({ error: { any: "object" } }) as Error).message, /non-Error thrown: object/);
  assert.equal(reportErrorOnce({ observability: undefined, error: new Error("x"), operation: "x" }), false);
});

test("a throwing adapter does not mark the request scope and never throws to the caller", () => {
  const scope: ErrorReportScope = { reported: false };
  const port: ObservabilityPort = { ...createNoopObservabilityPort({}), reportError: () => { throw new Error("adapter down"); } };
  runWithErrorReportScope({ scope, work: () => reportErrorOnce({ observability: port, error: new Error("y"), operation: "x" }) });
  assert.equal(scope.reported, false);
});

test("exact secrets are blanked even when they have no recognizable shape", () => {
  const { port, reports } = recording();
  const plain = ["plain", "key", String(Date.now())].join("-");
  reportErrorOnce({ observability: port, error: new Error(`provider echoed ${plain}`), operation: "assistant.run" }, { exactSecrets: [plain] });
  assert.ok(!(reports[0]!.error as Error).message.includes(plain));
});

test("the same error is independent across occurrences and destination ports", () => {
  const a = recording(), b = recording();
  const error = new Error("reusable");
  for (let occurrence = 0; occurrence < 2; occurrence++) {
    runWithErrorReportScope({ scope: { reported: false }, work: () => {
      for (const { port } of [a, b]) {
        assert.equal(reportErrorOnce({ observability: port, error, operation: "first" }), true);
        assert.equal(reportErrorOnce({ observability: port, error, operation: "second" }), false);
      }
    } });
  }
  assert.equal(a.reports.length, 2);
  assert.equal(b.reports.length, 2);
});

test("unscoped calls are independent; failed and noop hand-offs can retry in the same occurrence", async () => {
  const error = new Error("retry");
  const { port, reports } = recording();
  reportErrorOnce({ observability: port, error, operation: "one" });
  reportErrorOnce({ observability: port, error, operation: "two" });
  assert.equal(reports.length, 2);
  for (const mode of ["throw", "reject", "noop"] as const) {
    let unavailable = true;
    const destination: ObservabilityPort = { ...createNoopObservabilityPort({}), reportError(report) {
      if (!unavailable) { reports.push(report); return; }
      if (mode === "throw") throw new Error("provider down");
      if (mode === "reject") return Promise.reject(new Error("provider down"));
      return false;
    } };
    const observability = combineObservabilityPorts({ ports: [destination] });
    const scope = { reported: false };
    await runWithErrorReportScope({ scope, work: async () => {
      assert.equal(reportErrorOnce({ observability, error, operation: mode }), false);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(scope.reported, false);
      unavailable = false;
      assert.equal(reportErrorOnce({ observability, error, operation: mode }), true);
      assert.equal(reportErrorOnce({ observability, error, operation: mode }), false);
      assert.equal(scope.reported, true);
    } });
  }
  assert.equal(reports.length, 5);
});

test("one successful provider hand-off consumes the incident; async success marks only after admission", async () => {
  const { port, reports } = recording();
  const failed = { ...createNoopObservabilityPort({}), reportError() { throw new Error("down"); } };
  const error = new Error("mixed");
  const observability = combineObservabilityPorts({ ports: [failed, port] });
  runWithErrorReportScope({ scope: { reported: false }, work: () => {
    assert.equal(reportErrorOnce({ observability, error, operation: "mixed" }), true);
    assert.equal(reportErrorOnce({ observability, error, operation: "mixed" }), false);
  } });
  assert.equal(reports.length, 1);
  let accept!: () => void;
  const pending = new Promise<void>(resolve => { accept = resolve; });
  const stalled = { ...port, reportError: () => new Promise<boolean>(() => {}) };
  const asyncPort = combineObservabilityPorts({ ports: [stalled, { ...port, reportError: () => pending }] });
  const scope = { reported: false };
  await runWithErrorReportScope({ scope, work: async () => {
    assert.equal(reportErrorOnce({ observability: asyncPort, error, operation: "async" }), false);
    assert.equal(scope.reported, false);
    accept();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(scope.reported, true);
    assert.equal(reportErrorOnce({ observability: asyncPort, error, operation: "async" }), false);
  } });
});
