import { expect, expectTypeOf, it } from "vitest";
import type { ExternalMcpToolDeps } from "../external-mcp-tool-ports.js";
import type { DatabaseHealthSummary, SchemaStateSummary } from "../database-introspection.js";

it("absent OAuth is a valid non-OAuth tool dependency", () => {
  const deps = {} satisfies Pick<ExternalMcpToolDeps, "externalMcpOAuth">;
  expect(deps).not.toHaveProperty("externalMcpOAuth");
  expectTypeOf<{}>().toMatchTypeOf<Pick<ExternalMcpToolDeps, "externalMcpOAuth">>();
});

it("missing drift remains unknown, not in-sync", () => {
  const health = { canOpenDb: false, migrationsTableReadable: false, driftStatus: "unknown" } satisfies DatabaseHealthSummary;
  const state = { status: "unknown", siteMeta: null, runtime: null } satisfies SchemaStateSummary;
  expect(health.driftStatus).toBe("unknown");
  expect(state).toEqual({ status: "unknown", siteMeta: null, runtime: null });
  expectTypeOf<"unknown">().toMatchTypeOf<DatabaseHealthSummary["driftStatus"]>();
  expectTypeOf<"unknown">().toMatchTypeOf<SchemaStateSummary["status"]>();
});
