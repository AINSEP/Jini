import {
  authorizeAndCollectSection,
  DEFAULT_SECTION_TIMEOUT_MS,
  resolveRequestedSections,
  SectionUnavailableError,
  type CollectedSection,
  type InspectionAuthorizeFn,
  type InspectionFailureReporter,
  type InspectionSection,
} from "./section-collector.js";

/**
 * @file `buildSiteCapabilities()` — the one answer to "what can this site do?", behind the
 * `site_describe_capabilities` agent tool. It brings together three answers that used to live in
 * three places: the assistant's tools (`search_tools`/`describe_tool`), the admin app's screens
 * (reachable only through the live `page.find_elements` browser bridge), and content types
 * (`collections_content_type_list`).
 *
 * A call-time list keeps capability discovery on the tools' existing sources instead of making
 * an agent choose between parallel indexes. Nothing here is seeded, cached or ranked:
 * - tools — the composition root's live `ToolRegistry`, injected as `listCatalogTools` (bound by
 *   the host to its own tool-catalog query; a feature module may not import the host's assistant
 *   layer by value). Same `source` domain and same stripped description `search_tools` and
 *   `describe_tool` report.
 * - admin screens — the host's checked-in copy of its admin app's own
 *   agent-navigable screen list (injected as `listAdminScreens`), which a host-side test keeps from
 *   drifting.
 * - content types — the same `contentTypeRepo.listByWorkspace` read `collections_content_type_list`
 *   makes.
 *
 * Detail stays with the tools that own it: a tool entry is an id and one line, and the section says
 * to call `describe_tool`/`search_tools` for the rest.
 *
 * Per-section authorization, per-section status, and "one failing section never fails the call" come
 * from `section-collector.ts`, shared with `buildSiteProfile`.
 */

/** Every section this call can report — the closed vocabulary the `sections` input, the permission
 *  map and the response shape all derive from. */
export const SITE_CAPABILITIES_SECTION_NAMES = ["tools", "adminScreens", "contentTypes"] as const;

export type SiteCapabilitiesSectionName = (typeof SITE_CAPABILITIES_SECTION_NAMES)[number];

/**
 * The permission each section is authorized against, reused rather than minted:
 * - `tools` -> `admin.assistant.use` — what the assistant's own general tools
 *   (`assistant_admin_screen_link`, `assistant_ask_choice`) require. The list is the catalog a
 *   principal already reaches through `search_tools`.
 * - `adminScreens` -> `admin.assistant.use` — the same assistant-level floor. A screen list only tells
 *   an agent where a human could go; every screen still enforces its own permissions.
 * - `contentTypes` -> `admin.collections.read` (`collections_content_type_list`, and
 *   `site_get_profile`'s own `contentTypes` section).
 */
export const SITE_CAPABILITIES_SECTION_PERMISSIONS: Readonly<Record<SiteCapabilitiesSectionName, string>> = {
  tools: "admin.assistant.use",
  adminScreens: "admin.assistant.use",
  contentTypes: "admin.collections.read",
};

/** Longest tool summary, ellipsis included. The constraint is context tokens. Measured 2026-09-15 on the
 *  BYOK catalog (181 tools): the tools section is ~27KB of compact JSON at this cap, the whole response
 *  ~30KB compact and ~45KB pretty-printed (the MCP path pretty-prints tool results), and the same
 *  entries with full descriptions are ~118KB. The daemon's catalog is larger. */
export const MAX_TOOL_SUMMARY_CHARS = 120;

/** The `tools` section's `reason` when the composition root supplied no registry reader. */
const TOOLS_NOT_WIRED_REASON = "not-wired";

const TOOLS_NOTE =
  "Each tool is listed by id with the first line of its description. Call describe_tool with an id for its full description and input schema, or search_tools to find a tool by what it does. A listed tool still checks its own permission when you run it.";

const ADMIN_SCREENS_NOTE =
  "Screens of the admin app, served under /admin: path is the route inside it (path '/posts' opens /admin/posts). id is what page.navigate accepts when a live admin tab is attached. Each screen still enforces its own permissions.";

// ---------------------------------------------------------------------------
// Ports — structural, so this module imports nothing from the host's composition root or assistant layer.
// ---------------------------------------------------------------------------

/** One registered tool as the catalog presents it. `listToolCatalogEntries` returns this shape. */
export interface SiteCapabilityToolRow {
  id: string;
  /** The catalog domain `search_tools` reports for this id. */
  source: string;
  /** The authored description, search vocabulary already stripped. */
  description: string;
}

/** One agent-navigable admin screen. The host's generated admin-screen rows are this shape. */
export interface SiteCapabilityAdminScreen {
  id: string;
  label: string;
  /** Route path inside the admin app (base-agnostic; the app is served under `/admin`). */
  path: string;
  description?: string;
  routeTemplates?: readonly string[];
  allowedQueryParams?: Readonly<Record<string, readonly string[] | null>>;
  entityTargets?: readonly { readonly type: string; readonly routeTemplate: string }[];
}

/** The subset of a content-type row this call reads. `ContentTypeRecord` is a structural superset. */
export interface SiteCapabilityContentTypeRow {
  key: string;
  label: string;
  tombstonedAt?: string | null;
}

/** Every dependency `buildSiteCapabilities` has, bound by the host's deps adapter. */
export interface SiteCapabilitiesDeps {
  workspaceId: string;
  authorize: InspectionAuthorizeFn;
  clock: { nowIso(): string };
  /** The live registry reader. Absent when the composition root has no registry — the tools section
   *  then reports `unavailable`/{@link TOOLS_NOT_WIRED_REASON}, never an empty catalog. */
  listCatalogTools?: (() => readonly SiteCapabilityToolRow[]);
  listAdminScreens(): readonly SiteCapabilityAdminScreen[];
  listContentTypes(): Promise<readonly SiteCapabilityContentTypeRow[]>;
  /** The host's server-side reporter for a failed section (full error; never in the response). */
  reportSectionFailure: InspectionFailureReporter;
}

export interface BuildSiteCapabilitiesOptions {
  /** Which sections to collect. Omitted/empty means all of {@link SITE_CAPABILITIES_SECTION_NAMES}. */
  sections?: readonly SiteCapabilitiesSectionName[];
  /** Per-section wall clock before the section is marked `unavailable`/`timed-out`. */
  sectionTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface SiteCapabilitiesToolSummary {
  id: string;
  summary: string;
}

export interface SiteCapabilitiesToolDomain {
  domain: string;
  count: number;
  tools: SiteCapabilitiesToolSummary[];
}

export interface SiteCapabilitiesTools {
  total: number;
  domainCount: number;
  note: string;
  domains: SiteCapabilitiesToolDomain[];
}

export interface SiteCapabilitiesAdminScreens {
  total: number;
  note: string;
  screens: SiteCapabilityAdminScreen[];
}

export interface SiteCapabilitiesContentTypes {
  total: number;
  contentTypes: { key: string; label: string }[];
}

export interface SiteCapabilities {
  schemaVersion: "1";
  /** When the call STARTED. */
  capturedAt: string;
  /** `partial` when any REQUESTED section came back non-`ok`. */
  completeness: "complete" | "partial";
  sections: {
    tools?: InspectionSection<SiteCapabilitiesTools>;
    adminScreens?: InspectionSection<SiteCapabilitiesAdminScreens>;
    contentTypes?: InspectionSection<SiteCapabilitiesContentTypes>;
  };
}

/**
 * Shortens a tool description to one line: whitespace collapsed, first sentence only, capped at
 * {@link MAX_TOOL_SUMMARY_CHARS} on a word boundary with a trailing ellipsis.
 *
 * A sentence ends at `.`/`!`/`?` followed by whitespace and a capital letter (or the end of the text),
 * so "e.g. custom_credential_create" and "1.5" do not cut a sentence short.
 *
 * @param description - The authored description, search vocabulary already stripped.
 * @returns The one-line summary; `""` for an empty description.
 * @complexity O(n) in the description length.
 * @example summarizeToolDescription({ description: "Creates a form. Use forms_update_definition to change one." }); // => "Creates a form."
 */
export function summarizeToolDescription({ description }: { description: string }, _optional = {}): string {
  const text = description.replace(/\s+/g, " ").trim();
  const sentenceEnd = text.search(/[.!?](?=\s+[A-Z]|$)/);
  const sentence = sentenceEnd === -1 ? text : text.slice(0, sentenceEnd + 1);
  if (sentence.length <= MAX_TOOL_SUMMARY_CHARS) return sentence;

  const cut = sentence.slice(0, MAX_TOOL_SUMMARY_CHARS - 1);
  const lastSpace = cut.lastIndexOf(" ");
  // Break on a word only when that keeps most of the line; one enormous token is cut mid-word.
  const kept = lastSpace > MAX_TOOL_SUMMARY_CHARS / 2 ? cut.slice(0, lastSpace) : cut;
  return `${kept.trimEnd()}…`;
}

/** Code-unit order: deterministic regardless of the process locale. */
function compareCodeUnits({ a, b }: { a: string; b: string }, _optional = {}): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Collects the `tools` section: every registered tool, grouped by catalog domain, each as id plus
 * summary.
 *
 * @throws {SectionUnavailableError} `not-wired` when no registry reader was injected.
 * @complexity O(r log r) in registered tools — one grouping pass, then sorts.
 */
async function collectTools(deps: SiteCapabilitiesDeps): Promise<CollectedSection<SiteCapabilitiesTools>> {
  if (deps.listCatalogTools === undefined) throw new SectionUnavailableError({ reason: TOOLS_NOT_WIRED_REASON });

  const rows = deps.listCatalogTools();
  const toolsByDomain = new Map<string, SiteCapabilitiesToolSummary[]>();
  for (const row of rows) {
    const tools = toolsByDomain.get(row.source) ?? [];
    tools.push({ id: row.id, summary: summarizeToolDescription({ description: row.description }) });
    toolsByDomain.set(row.source, tools);
  }
  const domains = [...toolsByDomain.entries()]
    .sort(([a], [b]) => compareCodeUnits({ a, b }))
    .map(([domain, tools]) => ({
      domain,
      count: tools.length,
      tools: tools.sort((a, b) => compareCodeUnits({ a: a.id, b: b.id })),
    }));

  return { data: { total: rows.length, domainCount: domains.length, note: TOOLS_NOTE, domains } };
}

/**
 * Collects the `adminScreens` section, field by field so nothing beyond id/label/path can ride along.
 *
 * @complexity O(s) in screens.
 */
async function collectAdminScreens(deps: SiteCapabilitiesDeps): Promise<CollectedSection<SiteCapabilitiesAdminScreens>> {
  const screens = deps.listAdminScreens().map((screen) => ({
    id: screen.id, label: screen.label, path: screen.path,
    ...(screen.description ? { description: screen.description } : {}),
    ...(screen.routeTemplates ? { routeTemplates: screen.routeTemplates } : {}),
    ...(screen.allowedQueryParams ? { allowedQueryParams: screen.allowedQueryParams } : {}),
    ...(screen.entityTargets ? { entityTargets: screen.entityTargets } : {}),
  }));
  return { data: { total: screens.length, note: ADMIN_SCREENS_NOTE, screens } };
}

/**
 * Collects the `contentTypes` section: every live content type as key and label. Tombstoned types are
 * excluded — a deleted type is not something this site can do, and `site_get_profile` filters them
 * the same way.
 *
 * @throws Whatever `listContentTypes()` throws — the caller converts it to `unavailable`.
 * @complexity O(c) in content types.
 */
async function collectContentTypes(deps: SiteCapabilitiesDeps): Promise<CollectedSection<SiteCapabilitiesContentTypes>> {
  const contentTypes = (await deps.listContentTypes())
    .filter((row) => row.tombstonedAt === undefined || row.tombstonedAt === null)
    .map((row) => ({ key: row.key, label: row.label }));
  return { data: { total: contentTypes.length, contentTypes } };
}

/**
 * Builds the capabilities list: every requested section, each authorized against its own permission
 * and collected concurrently.
 *
 * @param deps - The narrow ports (see {@link SiteCapabilitiesDeps}).
 * @param input.principalId - The principal every section's `authorize()` call is made for.
 * @param options.sections - Which sections to collect. Omitted/empty means all of them.
 * @param options.sectionTimeoutMs - Per-section wall clock, default {@link DEFAULT_SECTION_TIMEOUT_MS}.
 * @returns A {@link SiteCapabilities}. `completeness` is `partial` when any requested section is not
 * `ok`. Never rejects for a section-level failure.
 * @complexity O(r log r + s + c) — registered tools dominate.
 * @example
 * const capabilities = await buildSiteCapabilities({ deps, input: { principalId: "p-1" } }, { sections: ["tools"] });
 */
export async function buildSiteCapabilities(
  { deps, input }: { deps: SiteCapabilitiesDeps; input: { principalId: string } },
  options: BuildSiteCapabilitiesOptions = {},
): Promise<SiteCapabilities> {
  const capturedAt = deps.clock.nowIso();
  const requested = resolveRequestedSections({ vocabulary: SITE_CAPABILITIES_SECTION_NAMES, requested: options.sections });
  const timeoutMs = options.sectionTimeoutMs ?? DEFAULT_SECTION_TIMEOUT_MS;

  const collect = <T>({ section, collector }: { section: SiteCapabilitiesSectionName; collector: () => Promise<CollectedSection<T>> }, _optional = {}) =>
    authorizeAndCollectSection({
      authorize: deps.authorize,
      workspaceId: deps.workspaceId,
      principalId: input.principalId,
      section,
      permission: SITE_CAPABILITIES_SECTION_PERMISSIONS[section],
      entityType: "site-capabilities-section",
      logLabel: "site-capabilities",
      reportFailure: deps.reportSectionFailure,
      timeoutMs,
      collect: collector,
    });

  const collectors: Record<SiteCapabilitiesSectionName, () => Promise<InspectionSection<unknown>>> = {
    tools: () => collect({ section: "tools", collector: () => collectTools(deps) }),
    adminScreens: () => collect({ section: "adminScreens", collector: () => collectAdminScreens(deps) }),
    contentTypes: () => collect({ section: "contentTypes", collector: () => collectContentTypes(deps) }),
  };

  const results = await Promise.all(requested.map(async (name) => [name, await collectors[name]()] as const));

  const sections: SiteCapabilities["sections"] = {};
  for (const [name, section] of results) {
    // Keyed by the same closed vocabulary as the response shape, so this is exhaustive by
    // construction; the cast only tells the compiler each payload matches its own key.
    (sections as Record<string, InspectionSection<unknown>>)[name] = section;
  }

  return {
    schemaVersion: "1",
    capturedAt,
    completeness: results.every(([, section]) => section.status === "ok") ? "complete" : "partial",
    sections,
  };
}
