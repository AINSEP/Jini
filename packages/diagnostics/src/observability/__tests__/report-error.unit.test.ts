import assert from "node:assert/strict";
import { test } from "vitest";

import { createNoopObservabilityPort, type ErrorReport, type ObservabilityPort } from "../index.js";

import { redactedError, reportErrorOnce, runWithErrorReportScope, type ErrorReportScope } from "../report-error.js";

/** @file `reportErrorOnce`: one redacted report per error object, marking the current request scope. */

function recording(): { port: ObservabilityPort; reports: ErrorReport[] } {
  const reports: ErrorReport[] = [];
  return { reports, port: { ...createNoopObservabilityPort({}), reportError: (report) => { reports.push(report); } } };
}

// Built at runtime so no secret-shaped literal sits in the repo.
const fakeSecret = () => ["sk", "live", "Q".repeat(12) + "z".repeat(12)].join("_");

test("an error object is reported once, with its operation and attributes", () => {
  const { port, reports } = recording();
  const failure = new Error("boom");
  assert.equal(reportErrorOnce({ observability: port, error: failure, operation: "site.publish" }, { attributes: { status: 500 } }), true);
  assert.equal(reportErrorOnce({ observability: port, error: failure, operation: "http.request" }), false);
  assert.equal(reports.length, 1);
  assert.equal(reports[0]!.error, failure, "nothing to redact: the original error object is handed over");
  assert.deepEqual(reports[0]!.context, { operation: "site.publish", attributes: { status: 500 } });
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

test("a report inside a request scope marks that scope; a throwing adapter never throws to the caller", () => {
  const scope: ErrorReportScope = { reported: false };
  const port: ObservabilityPort = { ...createNoopObservabilityPort({}), reportError: () => { throw new Error("adapter down"); } };
  runWithErrorReportScope({ scope, work: () => reportErrorOnce({ observability: port, error: new Error("y"), operation: "x" }) });
  assert.equal(scope.reported, true);
});

test("exact secrets are blanked even when they have no recognizable shape", () => {
  const { port, reports } = recording();
  const plain = ["plain", "key", String(Date.now())].join("-");
  reportErrorOnce({ observability: port, error: new Error(`provider echoed ${plain}`), operation: "assistant.run" }, { exactSecrets: [plain] });
  assert.ok(!(reports[0]!.error as Error).message.includes(plain));
});
