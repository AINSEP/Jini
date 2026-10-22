/**
 * @file Agent tools for site search (lot S6), subpath `@jini-ai/search/tools`.
 *
 * `search_query` and `search_status` are reads. `search_reindex` (bulk vendor writes = cost) and
 * `search_set_provider` (a settings change plus a full backfill into another backend) ask the human
 * first through core's approval lifecycle; only the reindex grant may be remembered, per provider.
 *
 * Agents only ever see PUBLIC results: `search_query` never passes viewer audiences to the service,
 * so a members-only document cannot reach a model context through this tool.
 *
 * Permission is checked through an injected `requirePermission` port (the `@jini-ai/db` transfer
 * tools' shape) rather than `@jini-ai/cms/core`'s helper, so this generic package keeps its single
 * `@jini-ai/core` dependency; the host binds the port to its own permission catalog.
 */
import {
  buildDomainRegistrations, createApprovalHandler, indexCatalogById, optionalString, readToolLimit, requireInputRecord, requireNoInput, requireString, ToolInputError,
  type AgentToolDefinition, type ApprovalAnswer, type DerivedRiskByToolId, type RememberedApprovalPort, type ToolExecutionContext, type ToolExecutionOptions, type ToolHandler, type ToolRegistration,
} from '@jini-ai/core';
import type { ProviderRegistry } from '@jini-ai/core/provider-registry';
import type { SearchProvider, SearchQuery } from './contract.js';
import type { SearchIndexer, SearchService } from './api.js';

export const SEARCH_TOOL_DOMAIN = 'search';
/** Reads: the setting and index health are site settings; results are public content only. */
export const SEARCH_READ_PERMISSION = 'settings.read';
/** Writes: choosing and re-filling a search backend is an integration change. */
export const SEARCH_MANAGE_PERMISSION = 'admin.integrations.manage';

/** What the human is asked to approve. */
export interface SearchApprovalDescription {
  readonly action: 'reindex' | 'set_provider';
  readonly siteId: string;
  readonly providerId: string;
  /** The provider the site uses now (null when search was never configured). */
  readonly fromProviderId: string | null;
  readonly summary: string;
}

export interface SearchToolDeps {
  readonly workspaceId: string;
  readonly siteId: string;
  readonly service: SearchService;
  readonly indexer: Pick<SearchIndexer, 'startRebuild'>;
  readonly registry: ProviderRegistry<SearchProvider>;
  /** @throws When the principal lacks the permission (the host's own error). */
  requirePermission(required: { readonly principalId: string; readonly permission: string }): Promise<void>;
  /** The host's confirmation transport (e.g. an approval card). */
  askHuman(required: { readonly ctx: ToolExecutionContext; readonly description: SearchApprovalDescription }, optional: ToolExecutionOptions): Promise<ApprovalAnswer>;
  /**
   * Persist the per-site `search.provider` setting. `principalId` is the calling tool principal, so
   * the host's settings ledger records who made the change (added 2026-10-21, additive).
   */
  setProviderSetting(required: { readonly siteId: string; readonly providerId: string; readonly principalId: string }): Promise<void>;
}

const NO_INPUT = { type: 'object', additionalProperties: false, properties: {} } as const;

export const catalog: AgentToolDefinition[] = [
  {
    name: 'search_query',
    description: "Searches this site's published content. Returns {status:'ok', providerId, page:{hits:[{key, url, title, snippet, highlights, score}], nextCursor?}}, or {status:'invalid', message} / {status:'unavailable', reason}. Results are PUBLIC content only (never members-only or draft documents), each re-checked as visible right now. Snippets are plain text; highlights are character ranges into the snippet. Pass nextCursor back as cursor for the next page.",
    sideEffects: 'none',
    authorization: { permission: SEARCH_READ_PERMISSION },
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['text'],
      properties: {
        text: { type: 'string', minLength: 1, description: 'What to search for.' },
        collections: { type: 'array', items: { type: 'string' }, description: 'Limit to these collections, e.g. ["post","page"].' },
        locale: { type: 'string' },
        filters: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] }, description: 'Exact-match field filters.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Hits per page (default 10, server-capped at 100).' },
        cursor: { type: 'string', description: 'nextCursor from the previous page of the same query.' },
      },
    },
  },
  {
    name: 'search_status',
    description: "Reports this site's search setup. Returns {siteId, active, building}, each null or {providerId, generation, registered, counts:{pending, indexed, unknown, failed}}. `building` is set while a reindex or provider switch is filling a new index; `registered:false` means that provider's plugin is not loaded. Read-only.",
    sideEffects: 'none',
    authorization: { permission: SEARCH_READ_PERMISSION },
    inputSchema: NO_INPUT,
  },
  {
    name: 'search_reindex',
    description: "Rebuilds this site's search index from scratch in the current provider (a new generation, filled in the background; the old index keeps serving until the new one is complete). This writes every public document to the provider and may cost money with a hosted vendor, so the human is asked to approve. Returns {started:true, providerId, generation} or {started:false, code|reason}.",
    sideEffects: 'mutates-durable-state',
    authorization: { permission: SEARCH_MANAGE_PERMISSION },
    actorClassRule: 'confirmer-must-equal-own-delegatedBy',
    inputSchema: NO_INPUT,
  },
  {
    name: 'search_set_provider',
    description: "Switches this site's search backend to a registered provider id and starts filling it in the background; the current provider keeps serving until the new index is complete. Always asks the human. Returns {started:true, providerId, generation} or {started:false, reason}. An unknown provider id is an input error listing the registered ids.",
    sideEffects: 'mutates-durable-state',
    authorization: { permission: SEARCH_MANAGE_PERMISSION },
    actorClassRule: 'confirmer-must-equal-own-delegatedBy',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['providerId'],
      properties: { providerId: { type: 'string', minLength: 1, description: 'A registered search provider id, e.g. "builtin".' } },
    },
  },
];

/** Independently derived from the calls each handler below makes. */
export const derivedRisk: DerivedRiskByToolId = new Map([
  // service.query -> provider.query + access.visibleKeys: reads only.
  ['search_query', 'none'],
  // service.status -> targets.get + state.counts: reads only.
  ['search_status', 'none'],
  // indexer.startRebuild -> targets.setBuilding: persists a new building generation.
  ['search_reindex', 'mutates-durable-state'],
  // setProviderSetting + indexer.startRebuild: persists the setting and a building generation.
  ['search_set_provider', 'mutates-durable-state'],
]);

type FilterValue = string | number | boolean;

function optionalStringList(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new ToolInputError({ message: `'${key}' must be an array of strings` });
  return value as string[];
}

function optionalFilters(input: Record<string, unknown>): Record<string, FilterValue> | undefined {
  const value = input.filters;
  if (value === undefined) return undefined;
  const scalar = (item: unknown) => ['string', 'number', 'boolean'].includes(typeof item);
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !Object.values(value).every(scalar)) {
    throw new ToolInputError({ message: "'filters' must be an object of string, number or boolean values" });
  }
  return value as Record<string, FilterValue>;
}

/** The tool input as a service query; audiences can never be part of it. */
function readQuery(rawInput: unknown): Omit<SearchQuery, 'audiences'> {
  const input = requireInputRecord({ input: rawInput });
  const optionals = {
    collections: optionalStringList(input, 'collections'),
    locale: optionalString({ input, key: 'locale' }),
    filters: optionalFilters(input),
    cursor: optionalString({ input, key: 'cursor' }),
  };
  const present = Object.fromEntries(Object.entries(optionals).filter(([, value]) => value !== undefined));
  return { text: requireString({ input, key: 'text' }), limit: readToolLimit({ input, max: 100, fallback: 10 }), ...present };
}

type Prepared = { readonly providerId: string; readonly fromProviderId: string | null } | { readonly refusal: { readonly started: false; readonly code: string; readonly message: string } };

/**
 * Build the four search tool registrations.
 * @param required - Site scope, the service/indexer/registry and the host's permission, approval and
 *   setting ports.
 * @param optional.remembered - Persisted approval grants; only `search_reindex:<providerId>` uses it.
 * @returns Registrations through core's `buildDomainRegistrations` (risk corroborated, schemas required).
 * @throws Permission and port failures propagate; malformed input is a `ToolInputError`.
 * @complexity O(1) wiring; each handler is one or two port calls.
 */
export function buildSearchToolRegistrations(required: SearchToolDeps, optional: { readonly remembered?: RememberedApprovalPort } = {}): ToolRegistration[] {
  const { workspaceId, siteId, service, indexer, registry } = required;
  const allow = (ctx: ToolExecutionContext, permission: string) => required.requirePermission({ principalId: ctx.principal.id, permission });
  const activeProviderId = async () => (await service.status({ siteId })).active?.providerId ?? null;

  /** Shared approval lifecycle for the two writes; `run` re-checks permission after the human wait. */
  const approvalTool = (spec: {
    action: SearchApprovalDescription['action'];
    prepare(ctx: ToolExecutionContext): Promise<Prepared>;
    rememberKey(providerId: string): string | undefined;
    summary(prepared: { providerId: string; fromProviderId: string | null }): string;
    effect(providerId: string, ctx: ToolExecutionContext): Promise<void>;
  }): ToolHandler => createApprovalHandler<Prepared, SearchApprovalDescription | undefined>({
    prepare: ({ ctx }) => spec.prepare(ctx),
    describe: ({ prepared }) => {
      if ('refusal' in prepared) return { ask: false, description: undefined };
      const key = spec.rememberKey(prepared.providerId);
      const description: SearchApprovalDescription = { action: spec.action, siteId, ...prepared, summary: spec.summary(prepared) };
      return { ask: true, description, ...(key === undefined ? {} : { rememberKey: key }) };
    },
    askHuman: ({ ctx, description }, options) => required.askHuman({ ctx, description: description as SearchApprovalDescription }, options),
    notConfirmed: ({ reason }) => ({ started: false, reason }),
    run: async ({ ctx, prepared }) => {
      if ('refusal' in prepared) return prepared.refusal;
      await allow(ctx, SEARCH_MANAGE_PERMISSION);
      await spec.effect(prepared.providerId, ctx);
      const targets = await indexer.startRebuild({ siteId, workspaceId, providerId: prepared.providerId });
      return { started: true, providerId: prepared.providerId, generation: targets.building?.generation ?? null };
    },
  }, optional.remembered ? { remembered: optional.remembered } : {});

  const reindex = approvalTool({
    action: 'reindex',
    prepare: async ctx => {
      requireNoInput({ input: ctx.input });
      await allow(ctx, SEARCH_MANAGE_PERMISSION);
      const providerId = await activeProviderId();
      if (providerId === null) return { refusal: { started: false, code: 'not_configured', message: 'search has no active provider yet; use search_set_provider' } };
      if (!registry.has({ id: providerId })) return { refusal: { started: false, code: 'provider_not_registered', message: `the active search provider '${providerId}' is not loaded` } };
      return { providerId, fromProviderId: providerId };
    },
    // A reindex of the same provider is a repeatable cost decision, so a grant may be remembered per provider.
    rememberKey: providerId => `search_reindex:${providerId}`,
    summary: ({ providerId }) => `Rebuild the search index in '${providerId}' (writes every public document to it).`,
    effect: async () => undefined,
  });

  const setProvider = approvalTool({
    action: 'set_provider',
    prepare: async ctx => {
      const providerId = requireString({ input: requireInputRecord({ input: ctx.input }), key: 'providerId' });
      await allow(ctx, SEARCH_MANAGE_PERMISSION);
      if (!registry.has({ id: providerId })) {
        throw new ToolInputError({ message: `unknown search provider '${providerId}'; registered: ${registry.list().map(entry => entry.id).join(', ') || 'none'}` });
      }
      return { providerId, fromProviderId: await activeProviderId() };
    },
    // Never remembered: each switch moves the site's content to a different backend.
    rememberKey: () => undefined,
    summary: ({ providerId, fromProviderId }) => `Switch site search from '${fromProviderId ?? 'none'}' to '${providerId}' and copy every public document into it.`,
    effect: (providerId, ctx) => required.setProviderSetting({ siteId, providerId, principalId: ctx.principal.id }),
  });

  return buildDomainRegistrations({
    domain: SEARCH_TOOL_DOMAIN, catalogModule: '@jini-ai/search/tools',
    catalog: indexCatalogById({ catalog }), derivedRisk,
    handlers: {
      search_query: async ctx => {
        const query = readQuery(ctx.input);
        await allow(ctx, SEARCH_READ_PERMISSION);
        // No audiences: agents get public results only.
        return service.query({ siteId, workspaceId, query });
      },
      search_status: async ctx => {
        requireNoInput({ input: ctx.input });
        await allow(ctx, SEARCH_READ_PERMISSION);
        return service.status({ siteId });
      },
      search_reindex: reindex,
      search_set_provider: setProvider,
    },
  });
}
