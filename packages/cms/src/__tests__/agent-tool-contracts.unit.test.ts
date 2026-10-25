import { describe, expect, it } from "vitest";

import { contentTypesAgentToolCatalog } from "../content-types/agent-tools.js";
import { entriesAgentToolCatalog } from "../entries/agent-tools.js";
import { mediaAgentToolCatalog } from "../media/agent-tools.js";
import { menusAgentToolCatalog } from "../navigation/agent-tools.js";
import { taxonomyAgentToolCatalog } from "../taxonomy/agent-tools.js";
import { getWorkspaceAgentToolCatalog } from "../workspace/agent-tools.js";
import { WIDGET_TYPE_REGISTRATIONS, findWidgetTypeRegistration, getWidgetTypeRegistration } from "../widgets/registry.js";

/**
 * @file Contract pins for every cms agent-tool catalog and the widget type registry (Stryker L4:
 * ~150 survivors where `inputSchema` / `required` / `additionalProperties` / `authorization` could be
 * loosened with no test failing). Expected values are INLINE literals, deliberately not a regenerated
 * snapshot: changing what an agent may send, or which permission a tool needs, must be a visible
 * edit to this file. String `description`s are stripped (prose, not contract); a PROPERTY named
 * `description` (an object) is kept.
 */

function contractOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(contractOf);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key, inner]) => !(key === "description" && typeof inner === "string")).map(([key, inner]) => [key, contractOf(inner)]));
  }
  return value;
}

const EXPECTED_CONTENTTYPES = [
  {
    name: "collections_content_type_list",
    sideEffects: "none",
    authorization: { permission: "admin.collections.read" },
    inputSchema: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  { name: "collections_plan_cleanup", sideEffects: "none", authorization: { permission: "admin.collections.read" } },
  {
    name: "collections_execute_cleanup",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    actorClassRule: "confirmer-must-equal-own-delegatedBy",
  },
  {
    name: "collections_content_type_define",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["key", "label", "fields"],
      properties: {
        key: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
        label: { type: "string" },
        fields: {
          type: "array",
          maxItems: 500,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "kind", "required", "queryable"],
            properties: {
              name: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
              kind: { type: "string", enum: ["text", "integer", "real", "boolean", "datetime", "relation", "json"] },
              required: { type: "boolean" },
              queryable: { type: "boolean" },
            },
          },
        },
      },
    },
  },
  {
    name: "collections_content_type_update_fields",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["key", "fields", "expectedVersion"],
      properties: {
        key: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
        fields: {
          type: "array",
          maxItems: 500,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "kind", "required", "queryable"],
            properties: {
              name: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
              kind: { type: "string", enum: ["text", "integer", "real", "boolean", "datetime", "relation", "json"] },
              required: { type: "boolean" },
              queryable: { type: "boolean" },
            },
          },
        },
        expectedVersion: { type: "integer" },
      },
    },
  },
  {
    name: "collections_content_type_deprecate",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["key", "expectedVersion"],
      properties: { key: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" }, expectedVersion: { type: "integer" } },
    },
  },
  {
    name: "collections_content_type_reactivate",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["key", "expectedVersion"],
      properties: { key: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" }, expectedVersion: { type: "integer" } },
    },
  },
  {
    name: "collections_content_type_tombstone",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["key", "expectedVersion"],
      properties: { key: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" }, expectedVersion: { type: "integer" } },
    },
  },
];

const EXPECTED_ENTRIES = [
  {
    name: "collections_entry_list",
    sideEffects: "none",
    authorization: { permission: "admin.collections.read" },
    inputSchema: { type: "object", additionalProperties: false, required: [], properties: { type: { type: "string" } } },
  },
  {
    name: "collections_entry_create",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["type", "slug", "title"],
      properties: {
        type: { type: "string", minLength: 1 },
        slug: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1 },
        fieldsJson: { type: "object" },
        bodyJson: {},
      },
    },
  },
  {
    name: "collections_entry_update",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "expectedVersion"],
      properties: {
        id: { type: "string", minLength: 1 },
        expectedVersion: { type: "integer" },
        title: { type: "string", minLength: 1 },
        fieldsJson: { type: "object" },
      },
    },
  },
  {
    name: "collections_entry_publish",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "expectedVersion"],
      properties: { id: { type: "string", minLength: 1 }, expectedVersion: { type: "integer" } },
    },
  },
  {
    name: "collections_entry_unpublish",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "expectedVersion"],
      properties: { id: { type: "string", minLength: 1 }, expectedVersion: { type: "integer" } },
    },
  },
];

const EXPECTED_MEDIA = [
  {
    name: "library_list",
    sideEffects: "none",
    authorization: { permission: "media.read" },
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "library_read",
    sideEffects: "none",
    authorization: { permission: "media.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["documentId"],
      properties: { documentId: { type: "string", minLength: 1 }, offset: { type: "integer", minimum: 0 } },
    },
  },
  {
    name: "media_list_assets",
    sideEffects: "none",
    authorization: { permission: "media.read" },
    inputSchema: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    name: "media_upload_asset",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "media.upload" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["filename", "contentType", "dataBase64"],
      properties: {
        filename: { type: "string", minLength: 1 },
        contentType: {
          type: "string",
          enum: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "image/avif",
            "image/svg+xml",
            "video/mp4",
            "video/webm",
            "audio/wav",
            "audio/mpeg",
            "audio/flac",
            "audio/mp4",
          ],
        },
        dataBase64: { type: "string", minLength: 1 },
        alt: { type: "string" },
        caption: { type: "string" },
        credit: { type: "string" },
      },
    },
  },
  {
    name: "media_update_metadata",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "media.update" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["mediaId"],
      properties: {
        mediaId: { type: "string" },
        title: { type: "string" },
        alt: { type: "string" },
        caption: { type: "string" },
        credit: { type: "string" },
        slug: { type: "string" },
        cssClass: { type: "string" },
        htmlAttributes: { type: "string" },
      },
    },
  },
  {
    name: "media_trash_asset",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "media.delete" },
    inputSchema: { type: "object", additionalProperties: false, required: ["mediaId"], properties: { mediaId: { type: "string" } } },
  },
];

const EXPECTED_MENUS = [
  {
    name: "menus_list_menus",
    sideEffects: "none",
    authorization: { permission: "admin.menus.read" },
    inputSchema: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    name: "menus_get_menu",
    sideEffects: "none",
    authorization: { permission: "admin.menus.read" },
    inputSchema: { type: "object", additionalProperties: false, required: ["menuId"], properties: { menuId: { type: "string" } } },
  },
  {
    name: "menus_create_menu",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.menus.create" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "slug"],
      properties: {
        title: { type: "string", minLength: 1 },
        slug: { type: "string", pattern: "^[a-z0-9-]+$" },
        items: {
          type: "array",
          items: { "$ref": "#/$defs/navItem" },
          "$defs": {
            navItem: {
              type: "object",
              additionalProperties: false,
              required: ["id", "target"],
              properties: {
                id: { type: "string", minLength: 1 },
                label: { type: "string" },
                target: {
                  oneOf: [
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["kind", "entryId"],
                      properties: {
                        kind: { const: "entryRef" },
                        entryId: { type: "string" },
                        entryType: { type: "string" },
                        lastKnownHref: { type: "string" },
                      },
                    },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["kind", "termId", "taxonomy"],
                      properties: { kind: { const: "termRef" }, termId: { type: "string" }, taxonomy: { type: "string" } },
                    },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["kind", "href"],
                      properties: { kind: { const: "url" }, href: { type: "string" } },
                    },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["kind", "route"],
                      properties: { kind: { const: "route" }, route: { type: "string" }, params: { type: "object" } },
                    },
                  ],
                },
                attrs: { type: "object" },
                children: { type: "array", items: { "$ref": "#/$defs/navItem" } },
              },
            },
          },
        },
        mode: { type: "string", enum: ["items", "html"] },
        html: { type: "string", maxLength: 200000 },
      },
    },
  },
  {
    name: "menus_update_menu_tree",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.menus.update" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "expectedVersion"],
      properties: {
        id: { type: "string" },
        expectedVersion: { type: "integer" },
        title: { type: "string" },
        slug: { type: "string", pattern: "^[a-z0-9-]+$" },
        items: {
          type: "array",
          items: { "$ref": "#/$defs/navItem" },
          "$defs": {
            navItem: {
              type: "object",
              additionalProperties: false,
              required: ["id", "target"],
              properties: {
                id: { type: "string", minLength: 1 },
                label: { type: "string" },
                target: {
                  oneOf: [
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["kind", "entryId"],
                      properties: {
                        kind: { const: "entryRef" },
                        entryId: { type: "string" },
                        entryType: { type: "string" },
                        lastKnownHref: { type: "string" },
                      },
                    },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["kind", "termId", "taxonomy"],
                      properties: { kind: { const: "termRef" }, termId: { type: "string" }, taxonomy: { type: "string" } },
                    },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["kind", "href"],
                      properties: { kind: { const: "url" }, href: { type: "string" } },
                    },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["kind", "route"],
                      properties: { kind: { const: "route" }, route: { type: "string" }, params: { type: "object" } },
                    },
                  ],
                },
                attrs: { type: "object" },
                children: { type: "array", items: { "$ref": "#/$defs/navItem" } },
              },
            },
          },
        },
        mode: { type: "string", enum: ["items", "html"] },
        html: { type: "string", maxLength: 200000 },
      },
    },
  },
  {
    name: "menus_assign_location",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.menus.assign" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["menuId", "locationKey"],
      properties: { menuId: { type: "string" }, locationKey: { type: "string", minLength: 1 } },
    },
  },
];

const EXPECTED_TAXONOMY = [
  {
    name: "taxonomy_list",
    sideEffects: "none",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    name: "taxonomy_create_taxonomy",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "hierarchical"],
      properties: { name: { type: "string", minLength: 1 }, hierarchical: { type: "boolean" } },
    },
  },
  {
    name: "taxonomy_create_term",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taxonomyId", "name"],
      properties: { taxonomyId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 }, parentId: { type: "string" } },
    },
  },
  {
    name: "taxonomy_rename_term",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["termId", "newName"],
      properties: { termId: { type: "string", minLength: 1 }, newName: { type: "string", minLength: 1 } },
    },
  },
  {
    name: "taxonomy_assign_terms",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["contentType", "contentId", "termIds"],
      properties: {
        contentType: { type: "string", minLength: 1 },
        contentId: { type: "string", minLength: 1 },
        termIds: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "taxonomy_unassign_terms",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["contentType", "contentId", "termIds"],
      properties: {
        contentType: { type: "string", minLength: 1 },
        contentId: { type: "string", minLength: 1 },
        termIds: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "taxonomy_plan_merge_term",
    sideEffects: "none",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fromTermId", "intoTermId"],
      properties: { fromTermId: { type: "string", minLength: 1 }, intoTermId: { type: "string", minLength: 1 } },
    },
  },
  {
    name: "taxonomy_execute_merge_term",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fromTermId", "intoTermId"],
      properties: { fromTermId: { type: "string", minLength: 1 }, intoTermId: { type: "string", minLength: 1 } },
    },
    actorClassRule: "confirmer-must-equal-own-delegatedBy",
  },
];

const EXPECTED_WORKSPACE = [
  {
    name: "workspace_get",
    sideEffects: "none",
    authorization: { permission: "workspace.manage" },
    inputSchema: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    name: "workspace_update",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "workspace.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: { name: { type: "string" }, slug: { type: "string" } },
    },
  },
  { name: "workspace_create", sideEffects: "mutates-durable-state", authorization: { permission: "workspace.manage" } },
  { name: "workspace_delete", sideEffects: "mutates-durable-state", authorization: { permission: "workspace.manage" } },
];

const EXPECTED_WIDGETS = {
  media: {
    typeKey: "media",
    capability: "entry-reference",
    configSchema: {
      type: "object",
      "x-gallery-config": true,
      properties: {
        mode: { type: "string" },
        html: { type: "string" },
        items: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            properties: { slug: { type: "string", "x-ref-target": "asset" }, alt: { type: "string" }, caption: { type: "string" } },
            required: ["slug"],
            additionalProperties: false,
          },
        },
        layout: { type: "string" },
        columns: { type: "integer", minimum: 1, maximum: 6 },
        aspectRatio: { type: "string" },
        htmlAttributes: { type: "string" },
        cssClass: { type: "string" },
      },
      additionalProperties: false,
    },
    placementContexts: ["region", "inline"],
    clamps: { maxItems: 50, timeoutMs: 10000 },
    resolverId: "gallery",
  },
  gallery: {
    typeKey: "gallery",
    capability: "entry-reference",
    configSchema: {
      type: "object",
      "x-gallery-config": true,
      properties: {
        mode: { type: "string" },
        html: { type: "string" },
        htmlAttributes: { type: "string" },
        cssClass: { type: "string" },
        items: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            properties: { slug: { type: "string", "x-ref-target": "asset" }, alt: { type: "string" }, caption: { type: "string" } },
            required: ["slug"],
            additionalProperties: false,
          },
        },
        images: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            properties: { mediaId: { type: "string", "x-ref-target": "asset" }, alt: { type: "string" }, caption: { type: "string" } },
            required: ["mediaId"],
            additionalProperties: false,
          },
        },
        layout: { type: "string", enum: ["grid", "carousel", "masonry"] },
        columns: { type: "integer", minimum: 1, maximum: 6 },
        aspectRatio: { type: "string" },
      },
      additionalProperties: false,
    },
    placementContexts: ["region", "inline"],
    clamps: { maxItems: 50, timeoutMs: 10000 },
    resolverId: "gallery",
  },
  text: {
    typeKey: "text",
    capability: "static",
    configSchema: { type: "object", properties: { body: { type: "string" } }, required: ["body"], additionalProperties: false },
    placementContexts: ["region", "inline"],
    clamps: { timeoutMs: 0 },
  },
  "social-links": {
    typeKey: "social-links",
    capability: "static",
    configSchema: {
      type: "object",
      properties: {
        links: {
          type: "array",
          items: {
            type: "object",
            properties: { platform: { type: "string" }, url: { type: "string" } },
            required: ["platform", "url"],
            additionalProperties: false,
          },
          maxItems: 20,
        },
      },
      required: ["links"],
      additionalProperties: false,
    },
    placementContexts: ["region", "inline"],
    clamps: { timeoutMs: 0 },
  },
  "recent-entries": {
    typeKey: "recent-entries",
    capability: "query",
    configSchema: {
      type: "object",
      properties: {
        maxItems: { type: "integer", minimum: 1, maximum: 20 },
        categoryTermId: { type: "string", "x-ref-target": "term" },
        collection: { type: "string" },
        where: { type: "object" },
        sort: { type: "string" },
        fields: { type: "array", maxItems: 20, items: { type: "string" } },
        layout: { type: "string" },
        columns: { type: "integer", minimum: 1, maximum: 6 },
        structuredData: { type: "string" },
      },
      required: ["maxItems"],
      additionalProperties: false,
    },
    placementContexts: ["region", "inline"],
    clamps: { maxItems: 20, timeoutMs: 500 },
    resolverId: "recent-entries",
  },
  menu: {
    typeKey: "menu",
    capability: "entry-reference",
    configSchema: {
      type: "object",
      properties: { menuRef: { type: "string", "x-ref-target": "entry" } },
      required: ["menuRef"],
      additionalProperties: false,
    },
    placementContexts: ["region", "inline"],
    clamps: { timeoutMs: 500 },
    resolverId: "menu",
  },
  "contact-form": {
    typeKey: "contact-form",
    capability: "form",
    configSchema: {
      type: "object",
      properties: { formDefinitionId: { type: "string", "x-ref-target": "entry" }, successMessage: { type: "string" } },
      required: ["formDefinitionId"],
      additionalProperties: false,
    },
    placementContexts: ["region", "inline"],
    clamps: { timeoutMs: 500 },
    resolverId: "contact-form",
  },
};

const CATALOGS = [
  ["contentTypes", contentTypesAgentToolCatalog, EXPECTED_CONTENTTYPES],
  ["entries", entriesAgentToolCatalog, EXPECTED_ENTRIES],
  ["media", mediaAgentToolCatalog, EXPECTED_MEDIA],
  ["menus", menusAgentToolCatalog, EXPECTED_MENUS],
  ["taxonomy", taxonomyAgentToolCatalog, EXPECTED_TAXONOMY],
  ["workspace", getWorkspaceAgentToolCatalog(), EXPECTED_WORKSPACE],
] as const;

describe("cms agent-tool catalogs: full contract", () => {
  it.each(CATALOGS)("%s catalog equals its pinned contract (names, sideEffects, authorization, inputSchema, actorClassRule)", (_name, catalog, expected) => {
    expect(contractOf(catalog)).toEqual(expected);
  });

  it.each(CATALOGS)("%s: every inputSchema is a closed object (additionalProperties:false) whose required keys are declared properties", (_name, catalog) => {
    for (const tool of catalog) {
      const schema = tool.inputSchema as { type?: string; additionalProperties?: unknown; required?: string[]; properties?: Record<string, unknown> } | undefined;
      if (!schema) continue;
      expect(schema.type, tool.name).toBe("object");
      expect(schema.additionalProperties, tool.name).toBe(false);
      for (const key of schema.required ?? []) expect(Object.keys(schema.properties ?? {}), `${tool.name}.${key}`).toContain(key);
    }
  });

  it.each(CATALOGS)("%s: every tool has a non-empty description and a permission", (_name, catalog) => {
    for (const tool of catalog) {
      expect(tool.description.trim().length, tool.name).toBeGreaterThan(0);
      expect(tool.authorization?.permission, tool.name).toMatch(/^[a-z]+(\.[a-z]+)+$/);
    }
  });

  it("tool names are unique across every catalog", () => {
    const names = CATALOGS.flatMap(([, catalog]) => catalog.map((tool) => tool.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it("getWorkspaceAgentToolCatalog returns a fresh array each call (callers cannot mutate a shared catalog)", () => {
    const first = getWorkspaceAgentToolCatalog();
    first.pop();
    expect(getWorkspaceAgentToolCatalog()).toHaveLength(EXPECTED_WORKSPACE.length);
  });
});

describe("widget type registry", () => {
  it("WIDGET_TYPE_REGISTRATIONS equals its pinned contract", () => {
    expect(contractOf(WIDGET_TYPE_REGISTRATIONS)).toEqual(EXPECTED_WIDGETS);
  });

  it("every registration is keyed by its own typeKey and has a closed configSchema", () => {
    for (const [key, registration] of Object.entries(WIDGET_TYPE_REGISTRATIONS)) {
      expect(registration.typeKey).toBe(key);
      expect(registration.configSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
  });

  it("getWidgetTypeRegistration returns the exact registration object", () => {
    for (const key of Object.keys(WIDGET_TYPE_REGISTRATIONS) as (keyof typeof WIDGET_TYPE_REGISTRATIONS)[]) {
      expect(getWidgetTypeRegistration({ typeKey: key })).toBe(WIDGET_TYPE_REGISTRATIONS[key]);
    }
  });

  it("findWidgetTypeRegistration finds every registered key and nothing else", () => {
    for (const registration of Object.values(WIDGET_TYPE_REGISTRATIONS)) {
      expect(findWidgetTypeRegistration({ raw: registration.typeKey })).toBe(registration);
    }
    for (const raw of ["", "TEXT", "text ", " text", "unknown", "constructor", "__proto__", "toString"]) {
      expect(findWidgetTypeRegistration({ raw }), raw).toBeUndefined();
    }
  });
});
