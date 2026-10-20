import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { createVerifiedOrigin, InMemoryOriginSettingRepo, OriginRegistry } from "@jini-ai/http-kit/verified-origin";
import type { MatchRequired } from "../matcher.js";
import type { RedirectRecord, RedirectResolution } from "../types.js";

// INV-03 defence: the exporter trusts only the root matcher's finished Location. Today the matcher
// always matches an exact literal at its own path, so the refusal below is only reachable if the
// matcher's semantics change; this pins that the exporter then refuses instead of emitting.
vi.mock("../matcher.js", async importOriginal => {
  const real = await importOriginal<typeof import("../matcher.js")>();
  return {
    ...real,
    match: (required: MatchRequired, optional: Record<string, never> = {}): RedirectResolution =>
      required.rules.length === 1 && required.request.phase === "post_content" ? { matched: false } : real.match(required, optional),
  };
});

const { toNetlifyRedirects } = await import("../host-config/index.js");

test("export refuses a literal the root matcher does not resolve at its own path", async () => {
  const oracle = new OriginRegistry({ repo: new InMemoryOriginSettingRepo({ seeds: [{
    workspaceId: "site", origin: createVerifiedOrigin({ scheme: "https", host: "trusted.example", verifiedAt: "2026-10-07T00:00:00.000Z", source: "workspace-setting" }), redirectAllowlist: [],
  }] }) });
  const literal: RedirectRecord = { id: "literal", workspaceId: "site", matchType: "exact", fromPattern: "/old", toTarget: "/new", statusCode: 301,
    status: "active", override: true, priority: 0, source: "manual", createdByPrincipal: "user", createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z", version: 1 };
  assert.deepEqual(await toNetlifyRedirects({ rules: [literal], oracle, reservedSegments: new Set() }, {}), {
    emitted: "", refused: [{ redirectId: "literal", reason: "host-match-would-widen" }],
  });
});
