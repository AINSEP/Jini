/** @file Consent tools share the HTTP service and Jini's held confirmation lifecycle. */
import { buildDomainRegistrations, indexCatalogById, ToolInputError, type AgentToolDefinition, type AgentToolSideEffect, type ToolExecutionContext, type ToolHandler, type ToolRegistration } from '@jini-ai/core';
import type { AssistantSurfaceDeps } from '@jini-ai/core/contracts/site/daemon-surface-exchanges';
import type { SurfaceDetail } from '@jini-ai/core/contracts/cards';
import type { ToolContributor } from '@jini-ai/core';
import { toolMetadata } from '@jini-ai/core/tool-metadata/consent';
import type { SiteConsentService } from './service.js';
import { parseConsentConfig } from './validation.js';

export interface ConsentToolDeps { siteConsent?: SiteConsentService }

/** The confirmation card a write describes; the host renders it and routes the click back to `toolId`. */
export interface ConsentApprovalDescription { toolId: string; errorCode: string; title: string; details: SurfaceDetail[]; warning?: string; confirmLabel: string }

/** The host's held-confirmation lifecycle: it freezes the prepared input, asks a human, then runs. */
export type ConsentApprovalToolHandler = <TPrepared>(
  required: {
    surfaces: AssistantSurfaceDeps;
    prepare: (required: { ctx: ToolExecutionContext }) => Promise<TPrepared>;
    describe: (required: { prepared: TPrepared }) => ConsentApprovalDescription;
    run: (required: { ctx: ToolExecutionContext; prepared: TPrepared }) => Promise<unknown>;
  },
  optional: { flag: string },
) => ToolHandler;

/** Host collaborators bound once at composition: the approval lifecycle and the closed request contract
 * shared with the host's HTTP transport (`readConsentRequest` rejects unknown fields; `consentRevisionToken`
 * reads a required nullable revision id). Both throw `ToolInputError` on refusal. */
export interface ConsentToolHost {
  bannerModeRefusal?: string | undefined;
  approvalToolHandler: ConsentApprovalToolHandler;
  readConsentRequest(required: { body: unknown; fields: readonly string[] }, optional?: Record<string, never>): Record<string, unknown>;
  consentRevisionToken(required: { input: Record<string, unknown>; key: string }, optional?: Record<string, never>): string | null;
}
const PATH = { type: 'string', description: 'One local public page path, default /; no external URL.' };
const TOKEN = { type: ['string', 'null'], description: 'The exact revision id from consent_get_settings, or null for no revision.' };
const CONFIG = { type: 'object', description: 'Full ConsentConfig: banner text, enabled, policyVersion, links, placement, regionMode, appearance tokens, customCss, optional legacy allowUnsafeEval boolean retained without effect. Four engine-owned categories cannot be changed.' };
/** Full schemas are also checked inside the shared service; no input can approve its own write. */
export const consentAgentToolCatalog: AgentToolDefinition[] = [
  ...['consent_get_readiness', 'consent_explain_blocked'].map(name => ({ name, description: 'Read a side-effect-free cookie consent dry run for one local rendered page: fixed categories, gated scripts/resources, placement, blocking problems. A sample is not a whole-site compliance verdict.', sideEffects: 'none' as const, authorization: { permission: 'settings.read' }, inputSchema: { type: 'object', properties: { path: PATH }, additionalProperties: false } })),
  { name: 'consent_get_settings', description: 'Read cookie banner draft, published revision and effective settings. Use returned ids for conflict-safe draft saves and publication.', sideEffects: 'none', authorization: { permission: 'settings.read' }, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'consent_update_settings', description: 'Save a new cookie consent draft after a human confirmation card. Leaves published enforcement in place. Read consent_get_settings first; pass full config and expectedDraftId. Invalid CSS remains an editable draft and blocks publication.', sideEffects: 'mutates-durable-state', authorization: { permission: 'settings.workspace.write' }, inputSchema: { type: 'object', required: ['config', 'expectedDraftId'], properties: { config: CONFIG, expectedDraftId: TOKEN }, additionalProperties: false } },
  { name: 'consent_publish_settings', description: 'Publish exactly the saved cookie consent draft after a human confirmation card. Rechecks permission and revision freshness. Enabled changes re-ask visitors under a new immutable policy revision. To publish without a banner, save enabled:false, publish it explicitly, then retry deployment; optional scripts will run without banner enforcement.', sideEffects: 'mutates-durable-state', authorization: { permission: 'settings.workspace.write' }, inputSchema: { type: 'object', required: ['draftId', 'expectedPublishedId'], properties: { draftId: { type: 'string' }, expectedPublishedId: TOKEN }, additionalProperties: false } },
];
export const consentDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  ['consent_get_settings', 'none'], ['consent_get_readiness', 'none'], ['consent_explain_blocked', 'none'],
  // saveDraft appends an immutable policy; publish atomically changes the public pointer.
  ['consent_update_settings', 'mutates-durable-state'], ['consent_publish_settings', 'mutates-durable-state'],
]);

/** Builds five tools; every write uses an immutable prepared input and a fresh service check.
 * @example buildConsentRegistrations({ siteConsent, host }, surfaces)
 * @complexity O(1) setup; effects/limits belong to the injected service. */
export function buildConsentRegistrations(deps: ConsentToolDeps & { host: ConsentToolHost }, surfaces: AssistantSurfaceDeps): ToolRegistration[] {
  const { approvalToolHandler, readConsentRequest, consentRevisionToken, bannerModeRefusal } = deps.host;
  /** Missing bindings are never replaced by a permissive in-memory store. */
  const service = (_input = {}, _options = {}) => {
    if (!deps.siteConsent) throw new ToolInputError({ message: 'The site consent service is unavailable. Nothing was changed.' });
    return deps.siteConsent;
  };
  /** Closed page input shared by both read diagnostics. */
  const diagnostic = async ({ principalId, input }: { principalId: string; input: unknown }, _options = {}) => {
    const raw = readConsentRequest({ body: input === undefined ? {} : input, fields: ['path'] });
    if (raw.path !== undefined && typeof raw.path !== 'string') throw new ToolInputError({ message: 'path must be a local page path.' });
    return service().readiness({ principalId, path: raw.path as string | undefined });
  };
  return buildDomainRegistrations({ metadata: toolMetadata, domain: 'consent', catalogModule: 'features/consent/tool-registrations.ts', catalog: indexCatalogById({ catalog: consentAgentToolCatalog }), derivedRisk: consentDerivedRisk, handlers: {
    consent_get_settings: async ctx => { readConsentRequest({ body: ctx.input === undefined ? {} : ctx.input, fields: [] }); return service().read({ principalId: ctx.principal.id }); },
    consent_get_readiness: ctx => diagnostic({ principalId: ctx.principal.id, input: ctx.input }),
    consent_explain_blocked: async ctx => { const result = await diagnostic({ principalId: ctx.principal.id, input: ctx.input }); return { ...result, explanation: 'Declared optional scripts wait until all their consent categories are effectively allowed. Unmanaged content and missing runtime slots need review; they are not automatically controlled. Durable grants wait for receipt confirmation.' }; },
    consent_update_settings: approvalToolHandler({ surfaces,
      prepare: async ({ ctx }) => {
        const input = readConsentRequest({ body: ctx.input, fields: ['config', 'expectedDraftId'] });
        const state = await service().read({ principalId: ctx.principal.id });
        return { config: parseConsentConfig({ value: input.config, bannerModeRefusal }), previous: state.draft?.config ?? state.effective, expectedDraftId: consentRevisionToken({ input, key: 'expectedDraftId' }) };
      },
      describe: ({ prepared }) => ({ toolId: 'consent_update_settings', errorCode: 'CONSENT', title: 'Save this cookie consent draft?', details: [{ label: 'Configuration', value: prepared.config, previous: prepared.previous }], confirmLabel: 'Save draft' }),
      run: ({ ctx, prepared }) => service().saveDraft({ principalId: ctx.principal.id, config: prepared.config, expectedDraftId: prepared.expectedDraftId, signal: ctx.signal }),
    }, { flag: 'saved' }),
    consent_publish_settings: approvalToolHandler({ surfaces,
      prepare: async ({ ctx }) => {
        const input = readConsentRequest({ body: ctx.input, fields: ['draftId', 'expectedPublishedId'] });
        const state = await service().read({ principalId: ctx.principal.id });
        const draftId = consentRevisionToken({ input, key: 'draftId' });
        if (!draftId || state.draft?.id !== draftId) throw new ToolInputError({ message: 'Reload the saved consent draft before publishing.' });
        return { draftId, expectedPublishedId: consentRevisionToken({ input, key: 'expectedPublishedId' }), config: parseConsentConfig({ value: state.draft.config, bannerModeRefusal }), previous: state.effective };
      },
      describe: ({ prepared }) => ({ toolId: 'consent_publish_settings', errorCode: 'CONSENT', title: 'Publish this cookie consent policy?', details: [{ label: 'Revision', value: prepared.draftId }, { label: 'Configuration', value: prepared.config, previous: prepared.previous }], warning: prepared.config.enabled ? 'Visitors will be asked again for this policy revision.' : 'The banner and declared-script consent will be disabled. Optional scripts may run without a visitor choice.', confirmLabel: 'Publish policy' }),
      run: ({ ctx, prepared }) => service().publish({ principalId: ctx.principal.id, draftId: prepared.draftId, expectedPublishedId: prepared.expectedPublishedId, signal: ctx.signal }),
    }, { flag: 'published' }),
  } });
}

/** Explicit composition contribution; no import-time registration or separate tool lifecycle. */
export function contributeConsentTools({ host }: { host: ConsentToolHost }, _options = {}): ToolContributor<ConsentToolDeps, AssistantSurfaceDeps> {
  return { domain: 'consent', build: (deps, surfaces) => buildConsentRegistrations({ ...deps, host }, surfaces), risk: consentDerivedRisk };
}
