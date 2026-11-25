import { toolMetadata } from '@jini-ai/core/tool-metadata/web';
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission, type AgentToolDefinition } from "@jini-ai/core";
import type { ToolContributor } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { MAX_MAX_CHARS, readWebFetchInput, type WebFetchInput, type WebFetchResult } from "./web-page.js";

/**
 * @file Maps the `web` catalog onto {@link fetchWebPage}. Every catalog entry is wired, so a future
 * entry without a handler fails the build. The handler gates on the same permission the catalog
 * declares (one evaluator, at the handler, per ADR-021 §2).
 */

const DOMAIN = "web";

/** This layer's own risk classification, cross-checked against the catalog's `sideEffects`. */
export const webDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> fetchWebPage(): guarded anonymous reads, optionally with browser data POST/PUT/PATCH; no local writes.
  ["web_fetch_page", "none"],
]);

export interface WebToolDeps { workspaceId: string; authorize: AuthorizeFn; derivedPublicOrigin?: string | undefined }

export function buildWebRegistrations<P>({ routeDeps, ports, host }: {
  routeDeps: WebToolDeps; ports: P;
  host: {
    catalog: readonly AgentToolDefinition[]; permission: string; catalogModule: string;
    fetchPage: (required: { input: WebFetchInput; ports: P; rateLimitScope: string }, optional?: { signal?: AbortSignal }) => Promise<WebFetchResult>;
    readPageBodyOptions: (required: { input: Record<string, unknown> }) => { find?: string | undefined; maxBytes?: number | undefined; textOnly?: boolean | undefined };
    shapePageBody: (required: { body: string }, optional?: { find?: string; maxBytes?: number; textOnly?: boolean }) => { bodyBytes: number; truncated: boolean } & (
      { body: string; matches?: never; matchCount?: never } | { matches: Array<{ offset: number; snippet: string }>; matchCount: number; body?: never }
    );
  };
}, _optional = {}): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    web_fetch_page: async ctx => {
      const raw = requireInputRecord({ input: ctx.input });
      const input = readWebFetchInput(raw);
      const { find } = host.readPageBodyOptions({ input: { find: raw.find } });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: host.permission }, { entityType: "web-page" });
      // Search beyond the output window, within the existing reader ceiling; maxChars bounds snippets.
      const page = await host.fetchPage({ input: find === undefined ? input : { ...input, maxChars: MAX_MAX_CHARS }, ports, rateLimitScope: routeDeps.workspaceId }, ctx.signal ? { signal: ctx.signal } : {});
      const { content, ...pageFacts } = page;
      const shaped = find === undefined ? undefined : host.shapePageBody({ body: content }, { find, maxBytes: input.maxChars });
      const result = shaped ? { ...pageFacts, ...shaped, truncated: page.truncated || shaped.truncated } : page;
      if (!result.screenshot) return result;
      const { screenshot, ...facts } = result;
      return { content: [{ type: "text", text: JSON.stringify(facts) }, { type: "image", mimeType: screenshot.mimeType, data: screenshot.data }] };
    },
  };
  return buildDomainRegistrations({ metadata: toolMetadata, domain: DOMAIN, catalogModule: host.catalogModule, catalog: indexCatalogById({ catalog: host.catalog }), handlers, derivedRisk: webDerivedRisk });
}

/**
 * Contributes the `web` tools — called once by `tool-catalog-manifest.ts`'s
 * `installFirstPartyToolContributors()`, which owns the guarded client (`WEB_FETCH_EGRESS_POLICY`).
 * One limiter per contributor, so the daemon and BYOK surfaces in one process share the budget.
 */
export function contributeWebTools<P>(
  { ports, host }: Pick<Parameters<typeof buildWebRegistrations<P>>[0], "ports" | "host">,
  { portsForSite }: { portsForSite?: (required: { deps: WebToolDeps }) => Partial<P> } = {},
): ToolContributor<WebToolDeps, unknown> {
  return { domain: DOMAIN, build: deps => buildWebRegistrations({ routeDeps: deps, ports: { ...ports, ...portsForSite?.({ deps }) }, host }), risk: webDerivedRisk };
}
