import assert from "node:assert/strict";
import { test } from "vitest";
import type { VerifiedOrigin } from "@jini-ai/http-kit/verified-origin";
import { checkRedirectLocation, type RedirectTargetOracle } from "../target-gate.js";

/** A relative Location is checked as an absolute URL on the workspace's verified origin; the
 *  authority is written the way a browser would, so a default port never appears in it. */

function oracleFor(origin: Omit<VerifiedOrigin, "verifiedAt" | "source">) {
  const checked: string[] = [];
  const oracle: RedirectTargetOracle = {
    canonicalOrigin: async () => ({ ...origin, verifiedAt: "2026-10-01T00:00:00.000Z", source: "workspace-setting" }),
    isAllowedRedirectTarget: async ({ url }) => { checked.push(url); return true; },
  };
  return { oracle, checked };
}

const cases: Array<[Omit<VerifiedOrigin, "verifiedAt" | "source">, string]> = [
  [{ scheme: "https", host: "site.example" }, "https://site.example/new"],
  [{ scheme: "https", host: "site.example", port: 443 }, "https://site.example/new"],
  [{ scheme: "http", host: "site.example", port: 80 }, "http://site.example/new"],
  [{ scheme: "http", host: "site.example" }, "http://site.example/new"],
  [{ scheme: "https", host: "site.example", port: 8443 }, "https://site.example:8443/new"],
  [{ scheme: "http", host: "localhost", port: 443 }, "http://localhost:443/new"],
];

for (const [origin, expected] of cases) {
  test(`a relative location on ${origin.scheme}://${origin.host}${origin.port === undefined ? "" : `:${origin.port}`} is checked as ${expected}`, async () => {
    const { oracle, checked } = oracleFor(origin);
    const verdict = await checkRedirectLocation({ context: { workspaceId: "ws" }, location: "new", oracle, reservedSegments: new Set() }, {});
    assert.deepEqual(checked, [expected]);
    assert.deepEqual(verdict, { kind: "allowed", candidate: expected });
  });
}
