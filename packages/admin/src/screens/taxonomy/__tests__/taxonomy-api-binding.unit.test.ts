import { describe, expect, it, vi } from "vitest";

import { createTaxonomyApi, type TaxonomyRequestFn } from "../api/taxonomy-api.js";
import { createMergeTermSectionPort } from "../hooks/merge-term-section-dependencies.hooks.js";
import { createNewTaxonomyFormPort } from "../hooks/new-taxonomy-form-dependencies.hooks.js";
import { createNewTermFormPort } from "../hooks/new-term-form-dependencies.hooks.js";
import { createTermPickerPort } from "../hooks/term-picker-dependencies.hooks.js";

/** @file Pins the taxonomy API client and its live ports to the host-injected `request`/`me`. */

function recordingRequest(response: unknown = {}): { request: TaxonomyRequestFn; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const request = (async (...args: unknown[]) => {
    calls.push(args);
    return response;
  }) as TaxonomyRequestFn;
  return { request, calls };
}

describe("createTaxonomyApi", () => {
  it("sends every call through the injected request with the route's path, method and body", async () => {
    const { request, calls } = recordingRequest();
    const api = createTaxonomyApi({ request });
    await api.listTaxonomies();
    await api.createTerm({ taxonomyId: "a/b", name: "Tag" }, { parentId: "p1" });
    await api.executeMergeTerm({ fromTermId: "t 1", intoTermId: "t2", confirmationToken: "tok" });
    await api.assignedTerms({ contentType: "post", contentId: "x&y" });
    expect(calls).toEqual([
      [{ path: "/taxonomy" }],
      [{ path: "/taxonomy/a%2Fb/terms" }, { init: { method: "POST", body: JSON.stringify({ name: "Tag", parentId: "p1" }) } }],
      [{ path: "/taxonomy/terms/t%201/merge/execute" }, { init: { method: "POST", body: JSON.stringify({ intoTermId: "t2", confirmationToken: "tok" }) } }],
      [{ path: "/taxonomy/assigned-terms?contentType=post&contentId=x%26y" }],
    ]);
  });
});

describe("taxonomy live ports", () => {
  it("delegate to the injected api client and the host's me", async () => {
    const { request, calls } = recordingRequest({ ok: true });
    const api = createTaxonomyApi({ request });
    const me = vi.fn(async () => ({ permissions: [] }) as never);
    const picker = createTermPickerPort({ api, me });
    await picker.me();
    await picker.createTerm({ taxonomyId: "tx", name: "N" });
    await picker.unassignTerms({ contentType: "post", contentId: "c", termIds: ["t"] });
    await createMergeTermSectionPort({ api }).planMergeTerm({ fromTermId: "f", intoTermId: "i" });
    await createNewTaxonomyFormPort({ api }).createTaxonomy({ name: "Topics", hierarchical: true });
    await createNewTermFormPort({ api }).createTerm({ taxonomyId: "tx", name: "N2" });
    expect(me).toHaveBeenCalledTimes(1);
    expect(calls.map(([required]) => (required as { path: string }).path)).toEqual([
      "/taxonomy/tx/terms",
      "/taxonomy/unassign-terms",
      "/taxonomy/terms/f/merge/plan",
      "/taxonomy",
      "/taxonomy/tx/terms",
    ]);
  });
});
