/** @file Shared site consent use cases for HTTP and assistant adapters. */
import type { ConsentConfig } from '@jini-ai/core/contracts/site/cookie-consent';
import type { ConsentReceiptStorageHealth } from '../node/index.js';
import { adaptLegacyAuthorize, requireToolPermission, ToolInputError } from '@jini-ai/core';
import type { AuthorizeFn } from '@jini-ai/core/contracts/events';
import type { SiteConsentState, SiteConsentStore } from './revisions.js';
import { SiteConsentConflict } from './revisions.js';
import { consentConfigProblems, parseConsentConfig } from './validation.js';
import type { ConsentProblem } from '@jini-ai/core/contracts/site/core-consent-refusal';
import { CATEGORIES as CONSENT_CATEGORIES } from '../contract.js';
import { DEFAULT_MAX_AGE_MS as CONSENT_MAX_AGE_MS } from '../contracts/policy.js';
import { CONSENT_MAX_CSS_LENGTH } from '../render/css.js';
import { SITE_CONSENT_BANNER_MODES, SITE_CONSENT_DEFAULT_CSS, SITE_CONSENT_DEFAULTS, SITE_CONSENT_PLACEMENTS, SITE_CONSENT_TEXT_LIMITS, withSiteConsentDefaultCss } from './config.js';
import { consentDeclarationReadiness, type ConsentDeclarationEvidence } from './readiness.js';
import { renderSiteConsentPreview } from './cookie-consent.js';

const CONSENT_CSS_SELECTORS = ['#jini-consent', '.jini-consent', '.jini-consent-reopen'];

/** The host's publish-refusal envelope: fixed code, wording and fix/rollback choices around the blocking problems. */
export interface ConsentDeploymentRefusal {
  code: string;
  error: string;
  blockingProblems: ConsentProblem[];
  choices: { id: string; label: string; href: string; action: string; warning?: string }[];
}

export interface ConsentServicePorts {
  bannerModeRefusal?: string | undefined;
  workspaceId: string;
  authorize: AuthorizeFn;
  store?: SiteConsentStore;
  ready: Promise<void>;
  clock: { nowIso(): string };
  ids: { newId(): string };
  trustedRegion: boolean;
  readLegacy(required: Record<string, never>, optional?: Record<string, never>): Promise<ConsentConfig>;
  /** True when no owner on/off choice exists, so `readLegacy().enabled` is only the product default. */
  defaultOnly(required: Record<string, never>, optional?: Record<string, never>): Promise<boolean>;
  privacyPageExists(required: { url: string }, optional?: Record<string, never>): Promise<boolean>;
  renderPage(required: { path: string }, optional?: Record<string, never>): Promise<{ html: string; ok: boolean; truncated: boolean }>;
  /** Inspect the live receipt backend without saving a visitor choice; errors block readiness. */
  receiptStorage(required: Record<string, never>, optional?: Record<string, never>): Promise<ConsentReceiptStorageHealth>;
  /** Admin-only evidence from the active source declarations and document construction capability. */
  declarationEvidence?(required: { path: string }, optional?: object): Promise<ConsentDeclarationEvidence>;
  /** Refresh construction-time publication after the durable store has committed. */
  published?(): Promise<void>;
  /** The host's local public page path boundary: returns the local path, throws `ToolInputError` for
   * traversal, API paths or an external URL. Checked before any render is allocated. */
  consentPagePath(required: { path: string }, optional?: Record<string, never>): string;
  /** The host's deployment refusal envelope; this package decides only WHEN to refuse. */
  deploymentRefusal(required: { problems: ConsentProblem[] }, optional?: Record<string, never>): ConsentDeploymentRefusal;
  /** Receives a plain message (no prefix) and the caught error; the host owns the console line and its
   * redaction. Called only on a degraded path that the service already turned into a safe result. */
  reportConsentFailure(required: { message: string; error: unknown }, optional?: Record<string, never>): void;
}

/** Missing declaration collection is failed evidence, never an empty protected source list. */
async function declarationDiagnostics({ ports, path, html }: { ports: ConsentServicePorts; path: string; html: string }) {
  if (!ports.declarationEvidence) return {
    declarations: [], warnings: [], truncated: false,
    categories: CONSENT_CATEGORIES.map(id => ({ id, required: id === 'necessary', editable: false })),
    problems: [{ code: 'DECLARATIONS_UNAVAILABLE', message: 'Script declarations could not be collected. Readiness cannot be established.' }],
  };
  const evidence = await ports.declarationEvidence({ path });
  return consentDeclarationReadiness({ html, ...evidence });
}

/** Unsaved input takes precedence over the draft, then the effective published/legacy policy.
 * An emptied Custom CSS previews the default style, exactly as the public site delivers it. */
function sampleConsentConfig({ state, proposed, bannerModeRefusal }: { state: SiteConsentState & { effective: ConsentConfig }; proposed: unknown; bannerModeRefusal?: string | undefined }, _options = {}): ConsentConfig {
  return withSiteConsentDefaultCss({ config: parseConsentConfig({ value: proposed === undefined ? state.draft?.config ?? state.effective : proposed, bannerModeRefusal }) });
}

/** Readiness requires complete bounded page evidence; banner preview is independent. */
function isCompleteConsentPage({ page }: { page: { ok: boolean; truncated: boolean } }, _options = {}): boolean {
  return page.ok && !page.truncated;
}

/** The legacy ledger allowed empty or longer copy; editor reads must let the owner repair it.
 * Defaults replace only out-of-range text in a copy; published policies and writes stay strict.
 * @complexity O(n) text length across seven bounded legacy fields; no storage writes. */
function legacyEditorConsentConfig({ config }: { config: ConsentConfig }, _options = {}): ConsentConfig {
  const normalized = { ...config };
  const limits = { ...SITE_CONSENT_TEXT_LIMITS, policyVersion: 64 };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const text = normalized[key];
    if (typeof text !== 'string') continue;
    const emptyAllowed = key === 'secondaryLinkLabel' && text.length === 0;
    if (text.length > limits[key] || (!emptyAllowed && !text.trim())) normalized[key] = SITE_CONSENT_DEFAULTS[key];
  }
  return normalized;
}
function createConsentReader(ports: ConsentServicePorts) {
  /** Deny before touching readiness, configuration or rendered content. */
  const authorize = async ({ principalId, write = false }: { principalId: string; write?: boolean }, _optional = {}) => {
    await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: ports.authorize }), principalId, workspaceId: ports.workspaceId, permission: write ? 'settings.workspace.write' : 'settings.read' }, { entityType: 'site-consent' });
    await ports.ready;
    if (!ports.store) throw new Error('The durable site consent policy store is unavailable.');
    return ports.store;
  };

  /** Resolve draft and published separately; malformed published data never falls back to OFF. */
  const read = async ({ principalId }: { principalId: string }, _optional = {}) => {
    const store = await authorize({ principalId });
    const state = await store.read({});
    const legacy = state.published ? null : legacyEditorConsentConfig({ config: await ports.readLegacy({}) });
    // An empty Custom CSS is what the public site fills with the default style, so the editor shows
    // that default in the field for the owner to edit (owner, 2026-10-22).
    const draft = state.draft && { ...state.draft, config: withSiteConsentDefaultCss({ config: state.draft.config }) };
    return { ...state, draft, effective: withSiteConsentDefaultCss({ config: parseConsentConfig({ value: state.published?.config ?? legacy, bannerModeRefusal: ports.bannerModeRefusal }) }), categoriesEditable: false,
      editor: { defaults: { ...SITE_CONSENT_DEFAULTS, customCss: SITE_CONSENT_DEFAULT_CSS }, placements: [...SITE_CONSENT_PLACEMENTS], textLimits: { ...SITE_CONSENT_TEXT_LIMITS },
        maxCssLength: CONSENT_MAX_CSS_LENGTH, cssSelectors: [...CONSENT_CSS_SELECTORS],
        regionModes: ['opt-in', 'auto'], bannerModes: [...SITE_CONSENT_BANNER_MODES],
        categories: CONSENT_CATEGORIES.map(id => ({ id, required: id === 'necessary', editable: false })),
        rules: { gpc: 'always-enforced', preferenceMaxAgeMs: CONSENT_MAX_AGE_MS, staticReceipts: false } } };
  };
  return { authorize, read };
}

function createConsentReadiness(ports: ConsentServicePorts, read: ReturnType<typeof createConsentReader>['read'], problems: (input: { config: ConsentConfig }) => Promise<ConsentProblem[]>) {
  /** Readiness needs writable proof storage as well as a safe local page sample.
   * Storage errors expose no private paths; render failure/truncation also blocks readiness. */
  const readiness = async ({ principalId, path = '/', config: proposed }: { principalId: string; path?: string | undefined; config?: unknown }, _optional = {}) => {
    const state = await read({ principalId });
    const config = sampleConsentConfig({ state, proposed, bannerModeRefusal: ports.bannerModeRefusal });
    path = ports.consentPagePath({ path });
    const blockingProblems = await problems({ config: { ...config, enabled: true } });
    let receipts: ConsentReceiptStorageHealth;
    try { receipts = await ports.receiptStorage({}); }
    catch { receipts = { writable: false, count: null }; }
    if (!receipts.writable || receipts.count === null) blockingProblems.push({ code: 'RECEIPT_STORAGE_UNAVAILABLE', message: 'Consent receipt storage is unavailable or not writable. Visitor choices cannot be saved reliably.' });
    // `config` came through parseConsentConfig, which refuses a config without a string placement,
    // so no default placement is needed here.
    const metadata = { receipts, enabled: state.effective.enabled, placement: config.placement, regionMode: config.regionMode, delivery: 'live', staticSupported: true, sampledPaths: [path], sampleOnly: true, blockingProblems };
    try {
      const page = await ports.renderPage({ path });
      if (!isCompleteConsentPage({ page })) blockingProblems.push({ code: 'PAGE_UNAVAILABLE', message: 'The rendered page is unavailable or exceeds the 1 MB audit limit.' });
      const dryRun = await declarationDiagnostics({ ports, path, html: page.html });
      blockingProblems.push(...dryRun.problems);
      return { ...metadata, ready: blockingProblems.length === 0, categories: dryRun.categories, declarations: dryRun.declarations, warnings: dryRun.warnings, truncated: dryRun.truncated || page.truncated,
        limitations: ['One server-rendered page sample; dynamic requests, server cookies and legal compliance require separate review.'] };
    } catch (error) {
      ports.reportConsentFailure({ message: 'The page could not be rendered; readiness remains unavailable.', error });
      blockingProblems.push({ code: 'RENDER_FAILED', message: 'The page could not be rendered safely. Readiness cannot be established.' });
      return { ...metadata, ready: false, categories: CONSENT_CATEGORIES.map(id => ({ id, required: id === 'necessary', editable: false })), declarations: [], warnings: [], truncated: false, limitations: ['Rendered evidence unavailable.'] };
    }
  };
  return { readiness };
}

function createConsentDeploymentCheck(ports: ConsentServicePorts, problems: (input: { config: ConsentConfig }) => Promise<ConsentProblem[]>) {
  const staticDeploymentRefusal = async ({ config }: { config: ConsentConfig }, _options = {}) => {
    const blockingProblems = await problems({ config });
    // The cookie-consent banner works on a static host (choices kept in the browser, labelled so).
    return blockingProblems.length ? ports.deploymentRefusal({ problems: blockingProblems }) : null;
  };

  /** Static publication uses browser-local evidence, with the same policy and privacy checks.
   * Unknown configuration remains blocking; explicit OFF remains a readable rollback. */
  const deploymentCheck = async ({ principalId, permission }: { principalId: string; permission: 'system.publish' | 'deployments.publish' }, _optional = {}) => {
    await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: ports.authorize }), principalId, workspaceId: ports.workspaceId, permission }, { entityType: 'site-publish' });
    try {
      await ports.ready;
      if (!ports.store) throw new Error('Consent store unavailable');
      const state = await ports.store.read({});
      // Default-only consent (no owner choice, nothing published) exports without the banner, as the
      // construction slot is empty for that default; the default is off live too (2026-11-02).
      if (!state.published && await ports.defaultOnly({})) return null;
      const effective = state.published?.config ?? await ports.readLegacy({});
      // Explicit OFF remains a rollback even when saved legacy copy exceeds today's editor limits.
      if (effective.enabled === false) return null;
      const config = parseConsentConfig({ value: effective, bannerModeRefusal: ports.bannerModeRefusal });
      return await staticDeploymentRefusal({ config });
    } catch (error) {
      ports.reportConsentFailure({ message: 'The consent policy could not be verified; deployment remains blocked.', error });
      return ports.deploymentRefusal({ problems: [{ code: 'CONSENT_UNAVAILABLE', message: 'The published consent policy could not be verified. Deployment was not started.' }] });
    }
  };
  return { deploymentCheck };
}


/** Creates one workspace's adapters over the engine and durable policy store.
 * Authorization remains in each operation so direct/tool callers cannot bypass the HTTP guard.
 * @example createSiteConsentService({ ports })
 * @complexity Fixed repository operations; readiness scans receipt filenames and renders one bounded page, never executes JS. */
export function createSiteConsentService({ ports }: { ports: ConsentServicePorts }, _options = {}) {
  const { authorize, read } = createConsentReader(ports);
  /** Engine validation plus this site's privacy-page linkage; no HTTP fetch to external policies. */
  const problems = async ({ config }: { config: ConsentConfig }, _optional = {}): Promise<ConsentProblem[]> => {
    const found = consentConfigProblems({ config, trustedRegion: ports.trustedRegion }, { cssBlocks: false });
    if (config.enabled && config.privacyPolicyUrl && !found.some(problem => problem.field === 'privacyPolicyUrl') && !await ports.privacyPageExists({ url: config.privacyPolicyUrl })) found.push({ code: 'PRIVACY_PAGE_MISSING', field: 'privacyPolicyUrl', message: 'Publish the linked privacy page before enabling consent.' });
    return found;
  };
  const { readiness } = createConsentReadiness(ports, read, problems);
  /** A separate scriptless banner preview; no page content is parsed or represented as protected. */
  const preview = async ({ principalId, path = '/', config: proposed }: { principalId: string; path?: string; config?: unknown }, _optional = {}) => {
    const state = await read({ principalId });
    const config = sampleConsentConfig({ state, proposed, bannerModeRefusal: ports.bannerModeRefusal });
    ports.consentPagePath({ path });
    const rendered = renderSiteConsentPreview({ config, policy: config.policyVersion });
    const html = `<!doctype html><html ${rendered.htmlAttrs}><head><meta charset="utf-8">${rendered.head}</head><body>${rendered.body}</body></html>`;
    const diagnostics = { warnings: rendered.problems.map(problem => ({ ...problem, field: 'appearance' })) };
    return { html, blockingProblems: await problems({ config }), ...diagnostics, sandbox: '', revisionId: state.draft?.id ?? state.published?.id ?? null };
  };
  /** Append an immutable draft; invalid CSS rules are diagnosed and dropped by the preview compiler. */
  const saveDraft = async ({ principalId, config: value, expectedDraftId, signal }: { principalId: string; config: unknown; expectedDraftId: string | null; signal?: AbortSignal }, _optional = {}) => {
    const store = await authorize({ principalId, write: true });
    const config = parseConsentConfig({ value, bannerModeRefusal: ports.bannerModeRefusal });
    const blockingProblems = await problems({ config });
    const revision = { id: ports.ids.newId(), config, actorId: principalId, createdAt: ports.clock.nowIso() };
    await store.saveDraft({ revision, expectedDraftId, signal });
    return { revision, blockingProblems };
  };
  /** The stored draft, never caller replacement fields, is what becomes public atomically. */
  const publish = async ({ principalId, draftId, expectedPublishedId, signal }: { principalId: string; draftId: string; expectedPublishedId: string | null; signal?: AbortSignal }, _optional = {}) => {
    const store = await authorize({ principalId, write: true });
    const state = await store.read({});
    if (state.draft?.id !== draftId) throw new SiteConsentConflict();
    const config = parseConsentConfig({ value: state.draft.config, bannerModeRefusal: ports.bannerModeRefusal });
    const blockingProblems = await problems({ config });
    if (blockingProblems.length) throw new ToolInputError({ message: blockingProblems.map(problem => problem.message).join(' ') });
    await store.publish({ draftId, expectedPublishedId, signal });
    try { await ports.published?.(); }
    catch (error) { ports.reportConsentFailure({ message: 'Cookie preferences were published, but the public preview could not refresh. A later request will try again.', error }); }
    return { published: true, revisionId: draftId };
  };
  const { deploymentCheck } = createConsentDeploymentCheck(ports, problems);
  return { read, readiness, preview, saveDraft, publish, deploymentCheck };
}
export type SiteConsentService = ReturnType<typeof createSiteConsentService>;

