import { toolMetadata } from "@jini-ai/core/tool-metadata/site-inspection";
import { adaptLegacyAuthorize } from "@jini-ai/core";
import { ToolInputError } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { AgentToolDefinition } from "@jini-ai/core";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import type { ObservabilityPort } from "@jini-ai/core/contracts/observability";
import type { RequestListener, Server } from "node:http";
type PageBodyOptions = { maxBytes?: number | undefined; find?: string | undefined; textOnly?: boolean | undefined };
declare const readPageBodyOptions: (required: { input: Record<string, unknown> }, optional?: Record<string, never>) => PageBodyOptions;

interface FetchLiveUrlDeps {
  listKnownOrigins(): Promise<readonly string[]>;
  httpClient: { send(request: HttpRequest): Promise<HttpResponse> };
  reservedSegments: ReadonlySet<string>;
  isEgressRefusal: (error: unknown) => error is { callerSafeMessage: string };
  observeFetch?: (event: { origin: string; status?: number; durationMs: number; outcome: "response" | "refused" | "failed" }) => void;
}
declare const fetchLiveUrl: (deps: FetchLiveUrlDeps, input: PageBodyOptions & { path: string; origin?: string | undefined }, optional?: Record<string, never>) => Promise<unknown>;
import { buildDomainRegistrations, indexCatalogById, optionalNumber, requireInputRecord, requireString, withSchemaOnRejection, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { requireToolPermission } from "@jini-ai/core";

import type { ToolContributor } from "@jini-ai/core";

interface FetchPublishedPageDeps {
  createSiteApp(optional?: { themeId?: string; consentAudit?: true }): RequestListener;
  readonly createServer?: (listener: RequestListener) => Server;
  readonly fetch?: typeof globalThis.fetch;
  readonly observability?: ObservabilityPort;
  readonly trackFetch: (required: { fetch: typeof globalThis.fetch; observability: ObservabilityPort }) => typeof globalThis.fetch;
  readonly reservedSegments: ReadonlySet<string>;
}
declare const fetchPublishedPage: (required: { deps: FetchPublishedPageDeps; input: { path: string } }, optional?: PageBodyOptions & { timeoutMs?: number }) => Promise<unknown>;

import { buildSiteCapabilities, SITE_CAPABILITIES_SECTION_NAMES } from "@jini-ai/cms/site-inspection/site-capabilities";
import { buildSiteProfile, SITE_PROFILE_SECTION_NAMES } from "@jini-ai/cms/site-inspection/site-profile";

/**
 * @file Maps the Site Inspection catalog onto `buildSiteProfile()` / `buildSiteCapabilities()` /
 * `fetchPublishedPage()`, as `ToolRegistration`s. The entire catalog is wired — there is no
 * `unwiredToolIds` set here, which means any future catalog entry added without a handler is a build
 * failure.
 *
 * ---------------------------------------------------------------------------
 * Authorization shape — the one thing in this file worth reading carefully
 * ---------------------------------------------------------------------------
 *
 * `fetch_published_page` follows the ordinary pattern: the domain function carries no `authorize()`
 * of its own, so this handler performs the check inline through the kit's `requireToolPermission`,
 * exactly like `theme_list` and `plugins_list` do. One evaluator, at the handler, per ADR-021 §2.
 *
 * `site_get_profile` deliberately does NOT call `requireToolPermission` at the top of its handler,
 * and that omission is the design rather than a gap. It has FIVE authorization decisions, not one:
 * `buildSiteProfile` authorizes each section against the permission that section's own domain
 * already uses, and marks a denied section `forbidden` instead of failing the call. Adding a
 * blanket gate here would produce one of two bad outcomes:
 *
 *  - if the blanket permission were STRICTER than a section's own, a caller entitled to four of the
 *    five sections would be refused outright, and
 *  - if it were LOOSER (the realistic accident), it would read as "this tool is authorized" and
 *    invite someone to delete the per-section checks — which is precisely the privilege-escalation
 *    bypass this design exists to prevent, since Tovu's domain tools authorize inside their own
 *    handler bodies rather than through a single policy gate.
 *
 * So `site_get_profile` is still fully gated; the gate is just five gates, and it lives one layer
 * down where both this tool AND the admin HTTP route reach it. A principal with no grants at all
 * gets a well-formed response in which every section is `forbidden` — which discloses nothing it
 * could not learn by calling the five underlying tools and being refused by each.
 *
 * `site_describe_capabilities` has the same shape for the same reason: three sections, three gates
 * inside `buildSiteCapabilities`, no blanket check here.
 */

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually does
 * — independent of the catalog's `sideEffects` declaration, which `assertToolIsWirable` refuses to
 * let drift from this map.
 */
/**
 * Binds the host's reserved-path policy and its outbound-span tracker (`trackFetch`) onto the
 * route deps the published-page fetch reads. The
 * route deps are the prototype rather than spread, so every field (including any lazily computed
 * one) is still read at the moment the fetch reads it, exactly as before the policy was injected.
 */
function withReservedSegments({ routeDeps }: { routeDeps: Parameters<typeof buildSiteInspectionRegistrations>[0] }, _optional = {}): FetchPublishedPageDeps {
  return Object.create(routeDeps.publishedPageDeps(), { reservedSegments: { value: routeDeps.reservedSegments }, trackFetch: { value: routeDeps.trackFetch } }) as FetchPublishedPageDeps;
}

export const siteInspectionDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> buildSiteProfile(): five concurrent reads (posts, in-memory themes, presentation settings,
  //    plugin discovery + activations, settings, content types). No writes anywhere on the path.
  ["site_get_profile", "none"],
  // -> buildSiteCapabilities(): the composition root's in-memory tool registry list, the generated
  //    admin screen constant, and one content-type list read. No writes anywhere on the path.
  ["site_describe_capabilities", "none"],
  // -> fetchPublishedPage(): boots the site's own Express app on a loopback port and issues one
  //    GET, the same thing `apps/website/src/features/site-export/site-exporter.ts` does per route. The handler writes nothing.
  //    See the catalog entry's own comment for the one disclosed caveat (a path matching a live
  //    redirect rule records a redirect hit, exactly as a real visit would).
  ["fetch_published_page", "none"],
  // -> fresh live-origin reads + guarded credential-free GETs; no writes.
  ["fetch_live_url", "none"],
]);

/** Raised for a bad `sections`/`pageLimit` input, so {@link isShapeRejection} can decorate it with
 *  the published schema. A named class rather than a bare `Error` for the same reason
 *  `features/theme/tool-registrations.ts` declares `ThemeNotFoundError`. */
class SiteInspectionInputError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = "SiteInspectionInputError";
  }
}

/** Errors a DIFFERENT input would fix, and therefore worth publishing the tool's schema back with.
 *  A timeout or an underlying repo failure is not one of these: retrying with different arguments
 *  would not help, and appending a schema would imply otherwise. */
function isShapeRejection({ error, isPublishedPagePathError }: { error: unknown; isPublishedPagePathError: (error: unknown) => boolean }, _optional = {}): boolean {
  return isPublishedPagePathError(error) || error instanceof SiteInspectionInputError;
}

/** No published-page context selector exists: point callers to the existing body selectors.
 * @throws ToolInputError before rendering; no input mutation or I/O. @complexity O(1).
 */
function normalizePublishedPageInput({ input }: { input: Readonly<Record<string, unknown>> }, _options = {}) {
  if (Object.hasOwn(input, "context")) throw new ToolInputError({ message: "fetch_published_page: context is not supported. Use find for matching snippets, or maxBytes to bound the body; for editable source use pages_read_html. Send again without context." });
  return { input, notes: [] };
}

/**
 * Reads and validates the optional `sections` array off a tool input, against one tool's closed
 * vocabulary.
 *
 * Rejects an unknown section name rather than silently dropping it: an agent that asked for
 * `"secrets"` and got a response with no `secrets` key would have no way to tell "that section does
 * not exist" from "that section came back empty", and would likely conclude the latter.
 *
 * @param input - The already-validated tool input record.
 * @param vocabulary - The calling tool's own section names.
 * @returns The requested section names, or `undefined` when the caller did not scope the call.
 * @throws {SiteInspectionInputError} When `sections` is present but is not an array of known section
 * names. The message names every valid value so the model can correct itself in one turn.
 * @complexity O(S) in the requested-section count, bounded by the closed vocabulary.
 * @example readSections({ sections: ["theme"] }, SITE_PROFILE_SECTION_NAMES); // => ["theme"]
 */
function readSections<N extends string>(input: Record<string, unknown>, vocabulary: readonly N[]): N[] | undefined {
  const raw = input["sections"];
  if (raw === undefined || raw === null) return undefined;
  const validNames = vocabulary.join(", ");
  if (!Array.isArray(raw)) {
    throw new SiteInspectionInputError({ message: `sections must be an array of section names — valid names are: ${validNames}` });
  }
  const known = new Set<string>(vocabulary);
  for (const candidate of raw) {
    if (typeof candidate !== "string" || !known.has(candidate)) {
      throw new SiteInspectionInputError({ message: `unknown section '${String(candidate)}' — valid names are: ${validNames}` });
    }
  }
  return raw as N[];
}

/** The live-fetch collaborators a composition supplies; this module binds the URL-space and egress policy. */
type HostLiveUrlDeps = Omit<FetchLiveUrlDeps, "reservedSegments" | "isEgressRefusal">;

export function buildSiteInspectionRegistrations(routeDeps: {
  workspaceId: string; authorize: AuthorizeFn; catalog: readonly AgentToolDefinition[]; readPermission: string;
  reservedSegments: FetchPublishedPageDeps["reservedSegments"];
  trackFetch: FetchPublishedPageDeps["trackFetch"];
  publishedPageDeps: () => FetchPublishedPageDeps;
  toSiteProfileDeps: () => Parameters<typeof buildSiteProfile>[0]["deps"];
  toSiteCapabilitiesDeps: () => Parameters<typeof buildSiteCapabilities>[0]["deps"];
  readPageBodyOptions: typeof readPageBodyOptions;
  fetchLiveUrl: typeof fetchLiveUrl;
  fetchPublishedPage: typeof fetchPublishedPage;
  isEgressRefusal: FetchLiveUrlDeps["isEgressRefusal"];
  isPublishedPagePathError: (error: unknown) => boolean;
}, liveDeps?: HostLiveUrlDeps): ToolRegistration[] {
  const CATALOG_BY_ID = indexCatalogById({ catalog: routeDeps.catalog });
  const handlers: Record<string, ToolHandler> = {
    site_get_profile: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input ?? {} });

      // NO blanket `requireToolPermission` here — see this file's header. `buildSiteProfile`
      // authorizes each section against that section's own domain permission.
      return withSchemaOnRejection({ toolId: "site_get_profile", catalog: CATALOG_BY_ID, isShapeRejection: ({ error }) => isShapeRejection({ error, isPublishedPagePathError: routeDeps.isPublishedPagePathError }), fn: async () =>
        buildSiteProfile({ deps: routeDeps.toSiteProfileDeps(), input: { principalId: ctx.principal.id } }, { sections: readSections(input, SITE_PROFILE_SECTION_NAMES), pageLimit: optionalNumber({ input: input, key: "pageLimit" }) }) });
    },

    site_describe_capabilities: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input ?? {} });

      // NO blanket gate here either — `buildSiteCapabilities` authorizes each of its three sections
      // against that section's own permission.
      return withSchemaOnRejection({ toolId: "site_describe_capabilities", catalog: CATALOG_BY_ID, isShapeRejection: ({ error }) => isShapeRejection({ error, isPublishedPagePathError: routeDeps.isPublishedPagePathError }), fn: async () =>
          buildSiteCapabilities({ deps: routeDeps.toSiteCapabilitiesDeps(), input: { principalId: ctx.principal.id } }, { sections: readSections(input, SITE_CAPABILITIES_SECTION_NAMES) }) });
    },

    fetch_live_url: async ctx => {
      const input = requireInputRecord({ input: ctx.input });
      const path = requireString({ input: input, key: "path" });
      const options = routeDeps.readPageBodyOptions({ input });
      if (input.origin !== undefined && typeof input.origin !== "string") throw new ToolInputError({ message: "fetch_live_url: origin must be a known HTTPS origin string." });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: routeDeps.readPermission }, { entityType: "published-page" });
      if (!liveDeps) throw new ToolInputError({ message: "fetch_live_url: the guarded live HTTP client is not wired on this host." });
      return routeDeps.fetchLiveUrl({ ...liveDeps, reservedSegments: routeDeps.reservedSegments, isEgressRefusal: routeDeps.isEgressRefusal }, { path, origin: input.origin as string | undefined, ...options });
    },
    fetch_published_page: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input });
      const path = requireString({ input: input, key: "path" });
      const options = routeDeps.readPageBodyOptions({ input });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: routeDeps.readPermission }, { entityType: "published-page" });

      return withSchemaOnRejection({ toolId: "fetch_published_page", catalog: CATALOG_BY_ID, isShapeRejection: ({ error }) => isShapeRejection({ error, isPublishedPagePathError: routeDeps.isPublishedPagePathError }), fn: async () => routeDeps.fetchPublishedPage({ deps: withReservedSegments({ routeDeps }), input: { path } }, options) });
    },
  };

  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "site-inspection",
    catalogModule: "features/site-inspection/agent-tools.ts",
    catalog: CATALOG_BY_ID,
    inputNormalizers: { fetch_published_page: normalizePublishedPageInput },
    handlers,
    derivedRisk: siteInspectionDerivedRisk,
  });
}

/**
 * Contributes Site Inspection's AI tools to the assistant's catalog — called once by
 * `apps/website/src/server/runtime/composition/tool-catalog-manifest.ts`'s `installFirstPartyToolContributors()`, not by importing this
 * module. Same seam every other converted domain uses; this module never imports `server/`, and
 * `assistant/tool-registrations.ts` reaches it only through a type-only import of
 * `SiteInspectionToolDeps`.
 *
 * `live` carries the guarded client plus the host's publish-peer rule (which unkeyed peer row is the
 * connected destination); the composition root binds that rule, so this feature does not import the
 * publish-content feature. Omitted (tests, older compositions): `fetch_live_url` has no live deps.
 */
export function contributeSiteInspectionTools(live?: HostLiveUrlDeps): ToolContributor<Parameters<typeof buildSiteInspectionRegistrations>[0], unknown> {
  return {
    domain: "site-inspection",
    build: deps => buildSiteInspectionRegistrations(deps, live),
    risk: siteInspectionDerivedRisk,
  };
}
