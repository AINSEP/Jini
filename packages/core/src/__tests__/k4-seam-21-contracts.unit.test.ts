import assert from "node:assert/strict";
import { test } from "vitest";

import type { ServerLogEntry, ServerLogLevel, ServerLogMetadata } from "../contracts/site/platform-server-logs.js";

/**
 * @file Type fixture for the server-log contracts copied into core by K4-seam-21. `pnpm typecheck`
 * compiles this file, so renaming or retyping a field these fixtures set fails here. The runtime
 * asserts only check each fixture keeps the values it was built with.
 */

const level: ServerLogLevel = "warn";
const metadata: ServerLogMetadata = { release: "host@1.0.0", environment: "local", traceId: "t1", spanId: "s1" };
const entry: ServerLogEntry = { ...metadata, seq: 7, at: "2026-01-01T00:00:00.000Z", level, source: "daemon", message: "redacted" };

test("K4-seam-21 server-log contracts keep the fields their fixtures set", () => {
  assert.equal(entry.seq, 7);
  assert.equal(entry.level, "warn");
  assert.equal(entry.source, "daemon");
  assert.equal(entry.traceId, "t1");
  assert.equal(entry.message, "redacted");
});
