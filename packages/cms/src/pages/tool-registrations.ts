import { toolMetadata } from "@jini-ai/core/tool-metadata/pages";
import { buildDomainRegistrations, indexCatalogById, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration, type ToolContributor, type AgentToolDefinition as PagesAgentToolDefinition } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { PostNotFoundError, type PostRepoPort } from "../posts/post.js";
import { ForbiddenError } from "../core/index.js";
import { forbiddenRule, withModelFacingErrors } from "@jini-ai/core/model-facing-tool-errors";
import { PageNotFoundError } from "./html-document-store.js";
import type { RecordPageHtmlWritePort, PagesHtmlDocumentStoreFactory } from "@jini-ai/core/contracts/site/page-html-store";
import type { PageHtmlRegionPorts } from "@jini-ai/core/contracts/site/html-region-ports";
import { readPageHtml } from "./tool-registrations.read.js";
import { writePageHtml } from "./tool-registrations.write.js";
import { writePageRegion, movePageRegion } from "./tool-registrations.regions.js";
import { normalizePageInput } from "./tool-registrations.shared.js";

/**
 * @file Maps the Pages catalog onto `PagesHtmlDocumentStore`, as `ToolRegistration`s.
 *
 * Authorization shape: the store carries no `authorize()` call of its own, so these handlers
 * perform the same inline permission check the admin routes perform themselves — the pattern
 * `content_post_list`/`content_post_get` already follow for the same reason.
 *
 * **Permission note.** `pages_write_html` checks `pages.edit_html` (SPEC-047 REQ-9) as of
 * 2026-09-05, matching the HTTP route to the same store (`routes/pages/update-html.ts`). This file
 * previously recorded the permission as a gap — both tools checked `content.read`/`content.write`,
 * which the built-in `editor` role holds, so an `editor` could drive page generation and thereby
 * write unsanitized script into the public site. It also recorded the fix as impossible here,
 * because no seeded row spelled `pages.edit_html`. `features/pages/permissions.ts` now creates that
 * row from this repo, via the host-facing permission-migration registry seam; see its header.
 *
 * `pages_read_html` deliberately still checks `content.read`. REQ-9 is about who may AUTHOR raw
 * markup, and reading a page's own stored body is not the injection capability — narrowing the read
 * too would cost `editor` a capability REQ-9 never asked to take, for no security gain.
 */

const pagesDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> PagesHtmlDocumentStore.read(): one indexed SELECT, no writes.
  ["pages_read_html", "none"],
  // -> ensureHtmlFormat() + write(): converts the row's format on first call, then a
  //    version-conditioned UPDATE of body_html. Durable either way.
  ["pages_write_html", "mutates-durable-state"],
  // -> read() + write(): a version-conditioned UPDATE of body_html carrying a spliced document.
  //    Writes strictly less of the row than `pages_write_html` does, but writes the same column of
  //    the same row through the same store — "smaller edit" is not a lower risk class, and an entry
  //    missing here is not a safe default: `assertRiskMetadataIsWirable` refuses to register a tool
  //    with no classification at all, so the tool would simply not exist at runtime.
  ["pages_write_region", "mutates-durable-state"],
  // -> read() + write(): the same version-conditioned UPDATE of body_html, carrying a reordered document.
  ["pages_move_region", "mutates-durable-state"],
]);


export interface PagesToolDeps {
  workspaceId: string;
  authorize: AuthorizeFn;
  pagesHtmlStore: PagesHtmlDocumentStoreFactory;
  postRepo: PostRepoPort;
  /** Renders a doc body as Page HTML. Absent only in standalone page-store consumers. */
  docBodyAsPageHtml?: (required: { bodyJson: unknown }, optional?: Record<string, never>) => string;

}

export function buildPagesRegistrations<D extends PagesToolDeps, TTokens = unknown, TLight = unknown>({ deps: routeDeps, host }: {
  deps: D;
  host: {
    catalog: readonly PagesAgentToolDefinition[];
    editHtmlPermission: string;
    regions: PageHtmlRegionPorts;
    readTheme(required: { deps: D }): Promise<{ id: string; tokens: TTokens; tokensLight: TLight } | null>;
    recordWrite(required: { deps: D }): RecordPageHtmlWritePort;
  };
}, _optional = {}): ToolRegistration[] {
  const CATALOG_BY_ID = indexCatalogById({ catalog: host.catalog });
  const handlers: Record<string, ToolHandler> = {
    pages_read_html: (ctx) => readPageHtml({ routeDeps, ctx, host }),
    pages_write_html: (ctx) => writePageHtml({ routeDeps, ctx, host }),
    pages_write_region: (ctx) => writePageRegion({ routeDeps, ctx, host }),
    pages_move_region: (ctx) => movePageRegion({ routeDeps, ctx, host }),
  };

  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "pages",
    catalogModule: "features/pages/agent-tools.ts",
    catalog: CATALOG_BY_ID as ReadonlyMap<string, PagesAgentToolDefinition>,
    // S2 (fix plan 2026-09-24, rows 13 + 18-pages) — Pages had no `withModelFacingErrors` wrap at
    // all (this file's own header dated that gap to before this fix: every rejection here was a
    // hand-built `ToolInputError` or nothing). A `PageNotFoundError` that reaches this point (a
    // genuinely missing row on the conversion path — see `openForFullWrite`'s own doc) is real
    // caller input the model can act on (try a different id), not an internal failure, so it earns
    // the same treatment `forbiddenRule` already gives every `ForbiddenError`. `toModelFacingWriteError`
    // stays a separate, inline reclassification at its own two call sites (unchanged) — it targets
    // `PageConcurrentEditError` specifically, with a narrower message than a generic allowlist rule
    // would produce.
    handlers: withModelFacingErrors({ handlers: handlers, rules: [forbiddenRule({ domainPrefix: "PAGES", error: ForbiddenError }), { error: PageNotFoundError, code: "PAGES_NOT_FOUND", guidance: "List pages with content_post_list, then pass its id." }, { error: PostNotFoundError, code: "PAGES_NOT_FOUND" }] }),
    derivedRisk: pagesDerivedRisk,
    inputNormalizers: Object.fromEntries([...CATALOG_BY_ID.keys()].map(toolId => [toolId,
      ({ input }: { input: Record<string, unknown> }, _options = {}) => normalizePageInput({ input, toolId }),
    ])),
  });
}

export { pagesDerivedRisk };

/**
 * Contributes Pages' AI tools to the assistant's catalog — called once by
 * `apps/website/src/server/runtime/composition/tool-catalog-manifest.ts`'s `installFirstPartyToolContributors()`, not by importing this
 * module. `assistant/tool-registrations.ts` no longer imports `buildPagesRegistrations`/
 * `pagesDerivedRisk` by name; this is the seam that replaced it (Stage 2 batch 2). Safe: the only
 * importer of `features/pages/tool-registrations` (relative or `#src/*` subpath) is
 * `assistant/tool-registrations.ts` itself, every other importer of `features/pages` at large is
 * `server/*` (never reachable from `assistant`). Domain behavior is reached through the Post and
 * Theme public APIs; active-theme settings are host-injected. `ToolContributor` stays type-only,
 * so contributing these tools creates no runtime edge back toward `assistant`.
 */
export function contributePagesTools<D extends PagesToolDeps, TTokens = unknown, TLight = unknown>({ host }: { host: Parameters<typeof buildPagesRegistrations<D, TTokens, TLight>>[0]["host"] }, _optional = {}): ToolContributor<D, unknown> {
  return { domain: "pages", build: deps => buildPagesRegistrations({ deps, host }), risk: pagesDerivedRisk };
}
