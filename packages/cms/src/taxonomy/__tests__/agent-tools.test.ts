import assert from "node:assert/strict";
import { test } from "vitest";
import { createTaxonomyAgentToolCatalog, taxonomyAgentToolCatalog } from "../index.js";

/**
 * @file The taxonomy agent-tool catalog's published contract: which tools exist, which are reads,
 * that the destructive merge only runs behind a human confirmation, and that every input schema is
 * closed and self-consistent (a host's registration kit publishes these schemas to the model).
 */

type Schema = { type: string; additionalProperties: boolean; required: string[]; properties: Record<string, { type?: string; enum?: unknown }> };
const byName = new Map(taxonomyAgentToolCatalog.map((tool) => [tool.name, tool]));

test("the catalog publishes exactly the list, four ordinary writes, the merge plan and the confirm-gated merge", () => {
  assert.deepEqual([...byName.keys()], [
    "taxonomy_list", "taxonomy_create_taxonomy", "taxonomy_create_term", "taxonomy_rename_term",
    "taxonomy_assign_terms", "taxonomy_unassign_terms", "taxonomy_plan_merge_term", "taxonomy_execute_merge_term",
  ]);
  assert.equal(byName.has("taxonomy_confirm_merge_term"), false, "an agent can never confirm a gated mutation itself");
});

test("only the list and the merge plan are side-effect free; everything else mutates durable state", () => {
  const reads = taxonomyAgentToolCatalog.filter((tool) => tool.sideEffects === "none").map((tool) => tool.name);
  assert.deepEqual(reads, ["taxonomy_list", "taxonomy_plan_merge_term"]);
  for (const tool of taxonomyAgentToolCatalog) {
    if (!reads.includes(tool.name)) assert.equal(tool.sideEffects, "mutates-durable-state", tool.name);
    assert.deepEqual(tool.authorization, { permission: "admin.taxonomy.manage" }, tool.name);
  }
});

test("the destructive merge is the only tool that requires the human's own confirmation", () => {
  const gated = taxonomyAgentToolCatalog.filter((tool) => tool.actorClassRule !== undefined);
  assert.deepEqual(gated.map((tool) => [tool.name, tool.actorClassRule]), [["taxonomy_execute_merge_term", "confirmer-must-equal-own-delegatedBy"]]);
});

test("every input schema is a closed object whose required keys are all declared properties", () => {
  for (const tool of taxonomyAgentToolCatalog) {
    const schema = tool.inputSchema as Schema;
    assert.equal(schema.type, "object", tool.name);
    assert.equal(schema.additionalProperties, false, tool.name);
    for (const key of schema.required) assert.ok(Object.hasOwn(schema.properties, key), `${tool.name}.${key}`);
    assert.ok(tool.description.length > 0, tool.name);
  }
});

test("contentType is an open string, so a Collection key reaches the write-service's own eligibility policy", () => {
  for (const name of ["taxonomy_assign_terms", "taxonomy_unassign_terms"]) {
    const contentType = (byName.get(name)!.inputSchema as Schema).properties.contentType!;
    assert.equal(contentType.type, "string");
    assert.equal(contentType.enum, undefined, name);
  }
});

test("both merge tools describe their two term ids distinctly while sharing the term-id shape", () => {
  for (const name of ["taxonomy_plan_merge_term", "taxonomy_execute_merge_term"]) {
    const { fromTermId, intoTermId } = (byName.get(name)!.inputSchema as Schema).properties as Record<string, { type: string; minLength: number; description: string }>;
    assert.deepEqual([fromTermId!.type, fromTermId!.minLength, intoTermId!.type, intoTermId!.minLength], ["string", 1, "string", 1]);
    assert.notEqual(fromTermId!.description, intoTermId!.description);
  }
});

test("the full catalog appends both reads without changing the base catalog", () => {
  const full = createTaxonomyAgentToolCatalog({ termListToolId: "content_read.taxonomy" });
  assert.deepEqual(full.slice(0, -2), taxonomyAgentToolCatalog);
  assert.deepEqual(full.slice(-2).map(tool => tool.name), ["taxonomy_get_term", "taxonomy_get_assigned_terms"]);
  assert.equal(taxonomyAgentToolCatalog.length, 8);
  const assignment = full.find(tool => tool.name === "taxonomy_assign_terms")!.inputSchema as Schema;
  const read = full.find(tool => tool.name === "taxonomy_get_assigned_terms")!.inputSchema as Schema;
  assert.deepEqual(read.properties.contentType, assignment.properties.contentType);
});

test("read descriptions preserve the host copy and inject only the term discovery ID", () => {
  const reads = createTaxonomyAgentToolCatalog({ termListToolId: "content_read.taxonomy" }).slice(-2);
  assert.equal(reads[0]!.description, "Reads one live term by termId, including its taxonomyId, parentId, name, status and version. Use for a tag or category's details before renaming or assigning it. Returns {term}; missing or trashed terms are refused. Requires admin.taxonomy.manage. Use content_read.taxonomy to list available terms.");
  assert.equal(reads[1]!.description, "Reads which tags, categories or taxonomy terms are assigned to a post, page or live collection entry. Use to show the tags on this post or categories on this page before changing them. Returns {contentType, contentId, terms:[{termId,name,slug,taxonomyId,taxonomyName}]} sorted by taxonomy then term name; untagged content returns an empty terms array. Slugs are derived from term names, since terms have no stored slug. Does not change assignments. Requires admin.taxonomy.manage and the content's edit permission; unknown content types are refused. Use taxonomy_list for all available terms, taxonomy_assign_terms to add them.");
  assert.equal(createTaxonomyAgentToolCatalog({ termListToolId: "terms_read" }).at(-2)!.description, reads[0]!.description.replace("content_read.taxonomy", "terms_read"));
});
