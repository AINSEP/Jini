/**
 * @file The Taxonomy agent-tool catalog — extends the shared catalog in `../agent-tools.ts`.
 *
 * A static, in-process description of every agent-callable tool this domain exposes. It ported
 * unchanged: the catalog is data plus its own local type definitions, naming no host module.
 *
 * The package barrel prefixes the three shared type names (`AgentToolDefinition` and friends) with
 * `Taxonomy` so several domains can export a catalog surface from one package without colliding.
 * They are aliased back here so a host's existing imports keep working.
 *
 * `taxonomy_execute_merge_term` is wired behind a human confirm in chat (2026-09-24) — see the
 * shared catalog's own header and the host's tool registrations.
 */
import { type AgentToolDefinition as TaxonomyAgentToolDefinition } from "@jini-ai/core";
import { taxonomyAgentToolCatalog as sharedCatalog } from "../agent-tools.js";

const assignmentProperties = sharedCatalog.find(tool => tool.name === "taxonomy_assign_terms")?.inputSchema?.properties;
if (!assignmentProperties || typeof assignmentProperties !== "object" || !("contentType" in assignmentProperties)) {
  throw new Error("Taxonomy assignment catalog has no content type schema");
}

/** Extends the shared write catalog locally; no new contributor replaces the taxonomy domain. */
export const taxonomyAgentToolCatalog: TaxonomyAgentToolDefinition[] = [...sharedCatalog, {
  name: "taxonomy_get_term",
  description: "Reads one live term by termId, including its taxonomyId, parentId, name, status and version. Use for a tag or category's details before renaming or assigning it. Returns {term}; missing or trashed terms are refused. Requires admin.taxonomy.manage. Use content_read.taxonomy to list available terms.",
  sideEffects: "none", authorization: { permission: "admin.taxonomy.manage" },
  inputSchema: { type: "object", additionalProperties: false, required: ["termId"], properties: { termId: { type: "string", minLength: 1 } } },
}, {
  name: "taxonomy_get_assigned_terms",
  description: "Reads which tags, categories or taxonomy terms are assigned to a post, page or live collection entry. Use to show the tags on this post or categories on this page before changing them. Returns {contentType, contentId, terms:[{termId,name,slug,taxonomyId,taxonomyName}]} sorted by taxonomy then term name; untagged content returns an empty terms array. Slugs are derived from term names, since terms have no stored slug. Does not change assignments. Requires admin.taxonomy.manage and the content's edit permission; unknown content types are refused. Use taxonomy_list for all available terms, taxonomy_assign_terms to add them.",
  sideEffects: "none",
  authorization: { permission: "admin.taxonomy.manage" },
  inputSchema: { type: "object", additionalProperties: false, required: ["contentType", "contentId"], properties: {
    contentType: assignmentProperties.contentType,
    contentId: { type: "string", minLength: 1 },
  } },
}];

export type { AgentToolDefinition, AgentToolSideEffect, AgentToolActorClassRule } from "@jini-ai/core";
