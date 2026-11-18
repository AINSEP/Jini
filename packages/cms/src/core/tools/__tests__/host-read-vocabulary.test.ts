import { expect, it } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { NEUTRAL_HOST_READ_VOCABULARY, hostReadRef, resolveHostReadRefs, type HostReadVocabulary } from "../host-read-vocabulary.js";
import { buildRedirectsToolRegistrations, type RedirectsPackageToolDeps } from "../../../redirects/tool-registrations.js";
import { buildWidgetsToolRegistrations } from "../../../widgets/tool-registrations.js";
import type { WidgetsPackageToolDeps } from "../../../widgets/tool-handlers.types.js";
import { taxonomyGetTermHandler } from "../../../taxonomy/tool-handlers.js";
import type { TaxonomyPackageToolDeps } from "../../../taxonomy/tool-handlers.types.js";

const HOST: HostReadVocabulary = { readRef: ({ entity }) => `host_read.${entity}` };

const descriptorText = (registrations: { descriptor: unknown }[]) => JSON.stringify(registrations.map((r) => r.descriptor));

it("fills every placeholder through the host's vocabulary and leaves other text alone", () => {
  const catalog = { a: [`see ${hostReadRef({ entity: "redirect" })} or ${hostReadRef({ entity: "widget_region" })}`], b: 3, c: "plain" };
  expect(resolveHostReadRefs({ value: catalog }, { hostReads: HOST })).toEqual({ a: ["see host_read.redirect or host_read.widget_region"], b: 3, c: "plain" });
  expect(catalog.a[0]).toContain("{{read:redirect}}");
});

it("names an entity, never a tool id, for a host that binds no vocabulary", () => {
  expect(resolveHostReadRefs({ value: hostReadRef({ entity: "widget_region" }) })).toBe("the widget region read tool");
  expect(NEUTRAL_HOST_READ_VOCABULARY.readRef({ entity: "taxonomy" })).toBe("the taxonomy read tool");
});

it("publishes the redirects and widgets tool text with the host's wording, or neutral wording, and no placeholder", () => {
  const redirects = (hostReads?: HostReadVocabulary) => descriptorText(buildRedirectsToolRegistrations({ deps: {} as RedirectsPackageToolDeps }, { hostReads }));
  const widgets = (hostReads?: HostReadVocabulary) => descriptorText(buildWidgetsToolRegistrations({ deps: { wrapHookRefusals: (handlers: never) => handlers } as unknown as WidgetsPackageToolDeps }, { hostReads }));
  expect(redirects(HOST)).toContain("as returned by redirects_create or host_read.redirect.");
  expect(widgets(HOST)).toContain("Call host_read.widget_region first to see the current baseVersion");
  expect(widgets(HOST)).toContain("(from host_read.widget_region) to keep editing");
  expect(widgets(HOST)).toContain("content_post_create or host_read.content_post)");
  for (const text of [redirects(), widgets(), redirects(HOST), widgets(HOST)]) expect(text).not.toContain("{{read:");
  expect(redirects()).not.toContain("host_read");
  expect(widgets()).toContain("Call the widget region read tool first");
});

it("words the term-not-found refusal through the host's vocabulary", async () => {
  const deps = { workspaceId: "ws", authorize: async () => ({ allowed: true, reason: "matched" }), termRepo: { findByIdFull: async () => null } } as unknown as TaxonomyPackageToolDeps;
  const run = (hostReads?: HostReadVocabulary) =>
    taxonomyGetTermHandler({ deps, surfaces: {} as never, hostReads })({ input: { termId: "gone" }, principal: { id: "owner" } } as ToolExecutionContext);
  await expect(run(HOST)).rejects.toThrow("term 'gone' was not found — call host_read.taxonomy to list valid terms");
  await expect(run()).rejects.toThrow("call the taxonomy read tool to list valid terms");
});
