import assert from "node:assert/strict";
import { test } from "vitest";

import type { ToolMetadataById } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { buildRedirectsToolRegistrations, redirectsDerivedRisk, type RedirectsPackageToolDeps } from "../../tool-registrations.js";
import { buildRedirectsRegistrations, contributeRedirectsTools } from "../tool-registrations.js";

/**
 * @file The site binding of the redirects tools: the host's injected metadata lands on the
 * registrations it names (and only those), the host's read vocabulary reaches model-facing text, and
 * the contributor's `build` ignores the assistant surfaces. Handler behaviour is pinned by
 * `../../__tests__/tool-registrations.test.ts`; nothing here calls a handler, so the deps are inert.
 */

const DEPS = {} as RedirectsPackageToolDeps;
const SURFACES = {} as AssistantSurfaceDeps;
const TOMBSTONE_METADATA = { search: { keywords: "remove redirect", queries: ["Delete that redirect"] } };
const TOOL_METADATA = { redirects_tombstone: TOMBSTONE_METADATA } as unknown as ToolMetadataById;
const HOST_READS = { readRef: ({ entity }: { entity: string }) => `host_read.${entity}` };

test("buildRedirectsRegistrations applies the injected host metadata to the tools it names only", () => {
  const byId = new Map(buildRedirectsRegistrations({ deps: DEPS, toolMetadata: TOOL_METADATA, hostReads: HOST_READS }).map((r) => [r.descriptor.id, r]));
  assert.deepEqual([...byId.keys()].sort(), ["redirects_create", "redirects_get", "redirects_get_hits", "redirects_import", "redirects_list", "redirects_tombstone", "redirects_update"]);
  assert.deepEqual(byId.get("redirects_tombstone")?.descriptor.metadata, TOMBSTONE_METADATA);
  assert.equal(byId.get("redirects_list")?.descriptor.metadata, undefined);
});

test("buildRedirectsRegistrations words host reads with the injected vocabulary", () => {
  const text = JSON.stringify(buildRedirectsRegistrations({ deps: DEPS, toolMetadata: {}, hostReads: HOST_READS }).map((r) => r.descriptor));
  assert.ok(text.includes("host_read.redirect"));
  assert.ok(!text.includes("the redirect read tool"));
});

test("contributeRedirectsTools builds the same registrations as the builder and carries the authored risk map", () => {
  const contributor = contributeRedirectsTools({ toolMetadata: TOOL_METADATA, hostReads: HOST_READS });
  assert.equal(contributor.domain, "redirects");
  assert.equal(contributor.risk, redirectsDerivedRisk);
  const built = contributor.build(DEPS, SURFACES).map((r) => [r.descriptor.id, r.descriptor.metadata, r.descriptor.description]);
  const direct = buildRedirectsRegistrations({ deps: DEPS, toolMetadata: TOOL_METADATA, hostReads: HOST_READS }).map((r) => [r.descriptor.id, r.descriptor.metadata, r.descriptor.description]);
  assert.deepEqual(built, direct);
  assert.equal(built.length, buildRedirectsToolRegistrations({ deps: DEPS }).length);
});
