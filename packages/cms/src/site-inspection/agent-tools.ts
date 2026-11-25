import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
import { SITE_CAPABILITIES_SECTION_NAMES } from "./site-capabilities.js";
import { SITE_PROFILE_SECTION_NAMES, DEFAULT_PAGE_ITEMS, MAX_PAGE_ITEMS } from "./site-profile.js";

export type AgentToolSideEffect = "none" | "mutates-durable-state" | "mints-token";

export type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect };

const SITE_PROFILE_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sections: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: [...SITE_PROFILE_SECTION_NAMES] },
      description:
        "Which sections to collect. Omit to collect all of them. Ask for only what you need — the cost of this call is the context tokens the answer occupies, not database time.",
    },
    pageLimit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_PAGE_ITEMS,
      description: `How many page/post rows to list in the 'pages' section. Default ${DEFAULT_PAGE_ITEMS}, hard maximum ${MAX_PAGE_ITEMS}. Totals and per-kind/per-status counts always reflect EVERY row regardless of this cap.`,
    },
  },
} as const;

const SITE_CAPABILITIES_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sections: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: [...SITE_CAPABILITIES_SECTION_NAMES] },
      description:
        "Which sections to return. Omit for all three. The tools section is the large one; ask for only 'adminScreens' or 'contentTypes' when that is all you need.",
    },
  },
} as const;

export function createFetchPublishedPageInputSchema({ maxPathLength, bodyBytes: { defaultMax, hardMax } }: {
  maxPathLength: number; bodyBytes: { defaultMax: number; hardMax: number };
}, _optional: Record<string, never> = {}) {
  return {
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: {
      type: "string",
      minLength: 1,
      maxLength: maxPathLength,
      description:
        "A root-relative path on THIS site, e.g. '/', '/about', '/blog/hello?page=2', '/robots.txt'. Must start with '/'. A full URL, a remote host, a protocol-relative '//host' path, a '..' segment, or anything under '/api/' is refused — this tool only ever fetches this site's own published routes.",
    },
    find: { type: "string", minLength: 1, maxLength: 200, description: "Case-insensitive plain substring; returns up to 20 snippets and total matches in available text." },
    textOnly: { type: "boolean", description: "Strip scripts, styles, comments and markup; decode entities before capping/searching." },
    maxBytes: {
      type: "integer",
      minimum: 1,
      maximum: hardMax,
      description: `Body bytes to return before truncating. Default ${defaultMax}; hard maximum ${hardMax}. The response reports 'truncated' when the cap stopped the read.`,
    },
  },
} as const;
}

/**
 * Every agent-callable tool this domain exposes. Every entry is wired — there is no
 * `unwiredToolIds` set in `tool-registrations.ts`, which means any future catalog entry added
 * without a handler is a build failure.
 */
export function createSiteInspectionAgentToolCatalog({ readPermission, capabilitiesVisibilityPermission, maxPathLength, bodyBytes, descriptions }: {
  readPermission: string; capabilitiesVisibilityPermission: string; maxPathLength: number;
  bodyBytes: { defaultMax: number; hardMax: number };
  descriptions: { profile: string; capabilities: string; live: string; published: string };
}, _optional: Record<string, never> = {}): readonly AgentToolDefinition[] {
  const FETCH_PUBLISHED_PAGE_INPUT_SCHEMA = createFetchPublishedPageInputSchema({ maxPathLength, bodyBytes });
  return [
  {
    name: "site_get_profile",
    description: descriptions.profile,
    sideEffects: "none",
    authorization: { permission: readPermission },
    inputSchema: SITE_PROFILE_INPUT_SCHEMA,
  },
  {
    name: "site_describe_capabilities",
    description: descriptions.capabilities,
    sideEffects: "none",
    authorization: { permission: capabilitiesVisibilityPermission },
    inputSchema: SITE_CAPABILITIES_INPUT_SCHEMA,
  },
  {
    name: "fetch_live_url",
    description: descriptions.live,
    sideEffects: "none",
    authorization: { permission: readPermission },
    inputSchema: { ...FETCH_PUBLISHED_PAGE_INPUT_SCHEMA, properties: {
      ...FETCH_PUBLISHED_PAGE_INPUT_SCHEMA.properties,
      origin: { type: "string", description: "Saved live HTTPS origin. Omit when exactly one is known; ambiguous/unknown selection lists the known origins." },
    } },
  },
  {
    name: "fetch_published_page",
    description: descriptions.published,
    // The handler issues one ordinary GET against this site's own public surface — the same thing
    // the static exporter (the host's `features/site-export/site-exporter.ts`) does for every route, and the same thing any
    // visitor does. It writes nothing itself. One disclosed caveat rather than a silent one: a path
    // that matches a live redirect rule records a redirect HIT through the ordinary redirect
    // middleware, exactly as a real visit to that path would. That is an analytics counter moving,
    // not state this tool authored, so it is classified with the other read tools.
    sideEffects: "none",
    authorization: { permission: readPermission },
    inputSchema: FETCH_PUBLISHED_PAGE_INPUT_SCHEMA,
  },
];
}
