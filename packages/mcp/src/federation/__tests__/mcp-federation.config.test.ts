import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { isFederationEnabled, parseAllowedToolNames, positiveIntOrDefault } from "../config.js";

/**
 * @file `mcp-federation/config.ts`'s three env-parsing helpers — `isFederationEnabled`,
 * `parseAllowedToolNames`, `positiveIntOrDefault` — had no test anywhere in the repo before this
 * file (confirmed via `grep -rl` across all of `src`, not just this scoped area; a same-named
 * `parseAllowedToolNames` in `external-mcp-store.ts` IS tested, but that is a different function in
 * a different file).
 */

describe("isFederationEnabled", () => {
  it("is true for '1', 'true', 'yes', 'on', case-insensitively", () => {
    for (const value of ["1", "true", "yes", "on", "TRUE", "Yes", "ON"]) {
      assert.equal(isFederationEnabled({ value: value }), true, `expected '${value}' to enable federation`);
    }
  });

  it("trims surrounding whitespace before matching", () => {
    assert.equal(isFederationEnabled({ value: "  true  " }), true);
  });

  it("is false for an unset value (undefined)", () => {
    assert.equal(isFederationEnabled({ value: undefined }), false);
  });

  it("is false for an empty string, '0', 'false', or any other text", () => {
    for (const value of ["", "0", "false", "no", "off", "enabled"]) {
      assert.equal(isFederationEnabled({ value: value }), false, `expected '${value}' to NOT enable federation`);
    }
  });
});

describe("parseAllowedToolNames", () => {
  it("returns null for an undefined value — 'use the preset's default'", () => {
    assert.equal(parseAllowedToolNames({ value: undefined }), null);
  });

  it("returns an empty array for an explicit empty string — 'allow nothing', distinct from null", () => {
    assert.deepEqual(parseAllowedToolNames({ value: "" }), []);
  });

  it("splits on commas, trims each entry, and drops empty entries from stray commas/whitespace", () => {
    assert.deepEqual(parseAllowedToolNames({ value: " list_tables, execute_sql ,, apply_migration " }), [
      "list_tables",
      "execute_sql",
      "apply_migration",
    ]);
  });

  it("returns a single-element array for a value with no commas", () => {
    assert.deepEqual(parseAllowedToolNames({ value: "list_tables" }), ["list_tables"]);
  });
});

describe("positiveIntOrDefault", () => {
  it("returns the fallback for an undefined value", () => {
    assert.equal(positiveIntOrDefault({ value: undefined, fallback: 42 }), 42);
  });

  it("returns the fallback for a non-numeric string", () => {
    assert.equal(positiveIntOrDefault({ value: "not-a-number", fallback: 42 }), 42);
  });

  it("returns the fallback for zero or a negative number", () => {
    assert.equal(positiveIntOrDefault({ value: "0", fallback: 42 }), 42);
    assert.equal(positiveIntOrDefault({ value: "-5", fallback: 42 }), 42);
  });

  it("parses a positive integer string", () => {
    assert.equal(positiveIntOrDefault({ value: "15000", fallback: 42 }), 15_000);
  });

  it("truncates a positive float-looking string via parseInt's own base-10 parse", () => {
    assert.equal(positiveIntOrDefault({ value: "15000.9", fallback: 42 }), 15_000);
  });
});
