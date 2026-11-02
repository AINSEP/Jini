import { createHash } from 'node:crypto';
import { API_ROOT, createApi, refusal, segment, PAGES_PROJECTS_PAGING } from './api.mjs';
import { prepareAssets } from './assets.mjs';
import { previewDomains, assertDomainApproval, applyDomains } from './domains.mjs';
import { normalizeDomain } from './zones.mjs';
import { pagesAddress } from './pages-upload.mjs';
import { formPageRoutes, formsWorkerParts, normalizeForms, previewForms, provisionForms } from './forms.mjs';

const WORKERS_TARGET_ID = 'cloudflare-workers';

/** Stable jini-<project> identity, retained for Pages; an explicitly recorded remote name wins. */
/**
   * Derives a stable, Cloudflare-Pages-safe project name from the caller's
   * `projectName` label. Deterministic (no random suffix) so repeated
   * publishes of the same logical site land on the same Cloudflare Pages
   * project — replaces the OD origin's `od-${projectId}-${hash}` convention,
   * which relied on an OD project id this package has no concept of.
   */
export function resourceName({ projectName, config, kit }, _options = {}) {
  if (config.resourceName) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(config.resourceName)) throw refusal({ kit, code: 'CLOUDFLARE_RESOURCE_NAME', message: 'The remote resource name is invalid. Use the exact existing Cloudflare project/script name.' });
    return config.resourceName;
  }
  const label = kit.safeDnsLabel(projectName) || 'site';
  return kit.safeDnsLabel(`jini-${label}`).slice(0, 63);
}

/** Read-only resource and domain inspection through the plugin-owned API. */
export async function previewTarget({ credential, config, kit, projectName, targetId, formDestination }, _options = {}) {
  const api = createApi({ credential, kit });
  const name = resourceName({ projectName, config, kit });
  const domain = config.customDomain ? normalizeDomain({ domain: config.customDomain, kit }) : undefined;
  try { return await inspectTarget({ api, config, kit, targetId, name, domain, formDestination }); }
  catch (error) {
    if (!domain) throw error;
    return { resourceName: name, targetId, hostingChanges: [], domains: { inventoryStatus: 'unknown', changes: [],
      errorCode: 'CLOUDFLARE_INVENTORY_UNKNOWN', hostnames: [domain, `www.${domain}`].map(hostname => ({ hostname, status: 'unknown' })),
      message: `Cannot safely inspect ${domain}. ${error.message} Complete the named read permission or setup step, then preview again.` } };
  }
}

async function inspectTarget({ api, config, kit, targetId, name, domain, formDestination }, _options = {}) {
  const path = targetId === WORKERS_TARGET_ID ? `${api.accountPath}/workers/scripts` : `${api.accountPath}/pages/projects`;
  const resources = await api.list({ path }, targetId === WORKERS_TARGET_ID ? {} : PAGES_PROJECTS_PAGING);
  // Workers scripts are identified by `id`, Pages projects by `name`.
  const existing = resources.find(resource => resource.id === name || resource.name === name);
  const hostingChanges = [{ action: existing ? 'update' : 'create', targetId, resourceName: name }];
  if (targetId === WORKERS_TARGET_ID) {
    await workersAddress({ api, kit, resourceName: name });
    hostingChanges.push({ action: 'enable-workers-dev', targetId, resourceName: name });
  }
  const domains = domain ? await previewDomains({ api, kit, targetId, resourceName: name, domain, zoneId: config.zoneId }) : undefined;
  const formSubmissions = await previewForms({ api, kit, resourceName: name, targetId, formDestination });
  return { resourceName: name, targetId, hostingChanges, ...(domains ? { domains } : {}), ...(formSubmissions ? { formSubmissions } : {}) };
}

/** Read workers.dev from Cloudflare. Never manufacture an account subdomain or register one. */
export async function workersAddress({ api, kit, resourceName }, _options = {}) {
  const result = await api.request({ path: `${api.accountPath}/workers/subdomain` }, { allowMissing: true });
  if (typeof result?.subdomain !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(result.subdomain)) throw refusal({ kit, code: 'CLOUDFLARE_SUBDOMAIN_REQUIRED', message: `Worker ${resourceName} needs this account's workers.dev subdomain. Open Workers & Pages in the Cloudflare dashboard, set it up, then preview again.` });
  return `https://${resourceName}.${result.subdomain}.workers.dev`;
}

/** One lifecycle shared by both hosting variants. The transport-specific uploader is injected.
 * Consent/stale checks precede ALL remote writes, including provisioning and upload sessions. */
export function createTarget({ credential, config, kit, targetId, upload }, _options = {}) {
  const api = createApi({ credential, kit });
  return {
    id: targetId,
    /** Read-only address resolution, sharing each variant's existing address owner. */
    resolvePublicUrl: ({ projectName }, _options = {}) => {
      const name = resourceName({ projectName, config, kit });
      return targetId === WORKERS_TARGET_ID ? workersAddress({ api, kit, resourceName: name }) : Promise.resolve(pagesAddress({ resourceName: name }));
    },
    async publish(input, options = {}) {
      const merged = { ...input, ...options };
      const name = resourceName({ projectName: input.projectName, config, kit });
      const requestedDomain = config.customDomain ?? merged.metadata?.customDomain;
      const domainInput = { api, kit, targetId, resourceName: name, domain: requestedDomain, zoneId: config.zoneId, approval: merged.metadata?.domainApproval };
      const plan = requestedDomain ? await assertDomainApproval(domainInput) : undefined;
      const prepared = preparePublish({ input: merged, kit, config, plan, targetId });
      const forms = await prepareForms({ api, kit, targetId, resourceName: name, formDestination: merged.metadata?.formDestination, files: merged.files });
      const hosting = await upload({ api, kit, resourceName: name, prepared: prepared.assets, ...(forms ? { forms: forms.parts } : {}) });
      const link = await kit.waitForReachableDeploymentUrl([hosting.url], { providerLabel: targetId });
      const hostnames = plan ? await applyDomains({ api, kit, plan, proof: prepared.proof }) : [];
      return publishResult({ targetId, name, accountId: api.accountId, hosting, link, hostnames, plan, forms });
    },
    checkReachability: url => kit.checkDeploymentUrl(url),
  };
}

/** The publish outcome: hosting status, unfinished custom domains, and safe provider metadata (never a key). */
function publishResult({ targetId, name, accountId, hosting, link, hostnames, plan, forms }, _options = {}) {
  const complete = hostnames.every(hostname => hostname.status === 'ready' && !hostname.operationFailed);
  return { targetId, url: hosting.url, deploymentId: hosting.deploymentId, status: complete ? link.status : 'link-delayed',
    statusMessage: complete ? link.statusMessage : `Hosting is ${link.status}; custom domains are unfinished. ${hostnames.filter(host => host.status !== 'ready' || host.operationFailed).map(host => host.message).join(' ')}`,
    providerMetadata: { resourceName: name, projectName: name, accountId, hosting: { ...link, url: hosting.url }, hostnames, ...(plan ? { domainChanges: plan.changes, zoneId: plan.zone.id } : {}),
      ...(forms ? { formSubmissions: forms.summary } : {}) } };
}

/** Workers with active forms: provision D1 and build the receiver parts. Pages and form-less sites keep assets only.
 * Runs after consent checks and before the upload session, so a failed provision changes no script. */
async function prepareForms({ api, kit, targetId, resourceName, formDestination, files }, _options = {}) {
  if (targetId !== WORKERS_TARGET_ID) return undefined;
  const normalized = normalizeForms({ formDestination, kit });
  if (!normalized) return undefined;
  const database = await provisionForms({ api, kit, resourceName });
  const parts = await formsWorkerParts({ manifest: normalized, secret: normalized.secret, databaseId: database.databaseId }, { pageRoutes: formPageRoutes({ files }) });
  return { parts, summary: { forms: normalized.forms.length, databaseId: database.databaseId, databaseName: database.databaseName } };
}

function preparePublish({ input, kit, config, plan, targetId }, _options = {}) {
  const maxFiles = targetId === WORKERS_TARGET_ID && config.assetPlan === 'paid' ? 100_000 : 20_000;
  const assets = prepareAssets({ files: input.files, responseHeaders: input.responseHeaders, kit }, { maxFiles });
  if (!plan) return { assets };
  const expected = createHash('sha256').update(JSON.stringify({ manifest: assets.manifest, config: assets.config })).digest('hex');
  const path = `/.well-known/tovu-deployment-${expected}.txt`;
  const proofFile = { file: path.slice(1), data: expected, contentType: 'text/plain' };
  return { assets: prepareAssets({ files: [...input.files, proofFile], responseHeaders: input.responseHeaders, kit }, { maxFiles }), proof: { path, expected } };
}

/** Verify active status with the account endpoint when an account is supplied. User-owned
 * tokens may require the user endpoint; a scope mismatch alone must not be called rejection.
 * No identity or provider body crosses this boundary. At most two bounded read-only requests.
 * @complexity O(1) requests and response processing (transport bounds response size).
 */
export async function verifyCredential({ credential, kit }, _options = {}) {
  const paths = credential.accountId
    ? [`/accounts/${segment({ value: credential.accountId })}/tokens/verify`, '/user/tokens/verify']
    : ['/user/tokens/verify'];
  return verifyAt({ credential, kit, paths, index: 0 });
}

/** One verify endpoint; a scope-shaped refusal falls through to the next endpoint when there is one.
 * A bounded recursion (at most `paths.length` requests) rather than a loop, so every path ends in a
 * return and there is no unreachable loop exit. */
async function verifyAt({ credential, kit, paths, index }) {
  let resp;
  try {
    resp = await kit.fetch(`${API_ROOT}${paths[index]}`, { method: 'GET', headers: { Authorization: `Bearer ${credential.token}` }, redirect: 'error' }, { timeoutMs: kit.timeouts.QUICK });
  } catch { return { ok: false, reason: 'unreachable' }; }
  if (!resp.ok && index + 1 < paths.length && [400, 401, 403, 404].includes(resp.status)) return verifyAt({ credential, kit, paths, index: index + 1 });
  return verifyVerdict({ resp });
}

/** The verdict of the last endpoint tried: only 401/403 or a disabled/expired token is `rejected`. */
async function verifyVerdict({ resp }) {
  if (!resp.ok) return { ok: false, reason: resp.status === 401 || resp.status === 403 ? 'rejected' : 'unreachable', statusCode: resp.status };
  let json;
  try { json = await resp.json(); }
  catch { return { ok: false, reason: 'unreachable', statusCode: resp.status }; }
  return tokenStatusVerdict({ json, statusCode: resp.status });
}

/** A readable verify body: `active` is ok, `disabled`/`expired` rejected, anything else unreachable. */
function tokenStatusVerdict({ json, statusCode }) {
  if (json?.success === true && json.result?.status === 'active') return { ok: true };
  if (json?.success === true && ['disabled', 'expired'].includes(json.result?.status)) return { ok: false, reason: 'rejected', statusCode };
  return { ok: false, reason: 'unreachable', statusCode };
}

export function validateConfig(config, _options = {}) {
  if (config.assetPlan && !['free', 'paid'].includes(config.assetPlan)) return 'assetPlan must be free or paid. Select the actual Workers account plan.';
  return null;
}
