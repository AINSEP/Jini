import { createHash } from 'node:crypto';
import { refusal } from './api.mjs';
import { normalizeDomain, resolveZone } from './zones.mjs';
import { planDns } from './dns.mjs';
import { readDomainInventory, planBindings } from './domain-inventory.mjs';
import { pollDomains } from './domain-status.mjs';

/** Authenticated reads only. Unknown inventory always produces an empty executable change list.
 * Both hostnames retain current records, bindings, routes and individual states for the later UI. */
export async function previewDomains({ api, kit, targetId, resourceName, domain, zoneId }, _options = {}) {
  const apex = normalizeDomain({ domain, kit });
  const hostnames = [apex, `www.${apex}`];
  try {
    const zone = await resolveZone({ api, domain: apex, zoneId: zoneId ?? api.zoneId });
    const inventory = await readDomainInventory({ api, zone });
    const hosts = hostnames.map(hostname => planHostname({ inventory, hostname, targetId, resourceName, zone, accountPath: api.accountPath }));
    // A wildcard route can occur in both host views. Remove it ONCE, with the full before-image.
    const changes = [...new Map(hosts.flatMap(host => host.changes).map(change => [`${change.method}:${change.path}:${JSON.stringify(change.body)}`, change])).values()];
    const details = { targetId, resourceName, accountId: api.accountId, zone, hostnames: hosts, changes };
    return { ...details, inventoryStatus: 'complete', fingerprint: fingerprint({ details }), message: 'Review every change. DNS, binding and certificate propagation can interrupt the existing site. Mail, TXT and CAA records are preserved.' };
  } catch (error) {
    return { inventoryStatus: 'unknown', targetId, resourceName, hostnames: hostnames.map(hostname => ({ hostname, status: 'unknown' })), changes: [], errorCode: 'CLOUDFLARE_INVENTORY_UNKNOWN', message: `Cannot safely inspect ${apex}. ${error.message} Complete account/zone read permissions and preview again.` };
  }
}

function planHostname(input, _options = {}) {
  const bindings = planBindings(input);
  const dns = planDns({ ...input, records: input.inventory.records, zoneId: input.zone.id, preserveWorkerDns: input.targetId === 'cloudflare-workers' && bindings.owned });
  // Pages must be associated before DNS points at it. Conflicting records/bindings go first.
  const all = [...bindings.changes, ...dns.changes];
  const removals = all.filter(change => change.method === 'DELETE');
  const additions = [...bindings.changes, ...dns.changes].filter(change => change.method !== 'DELETE');
  return { hostname: input.hostname, status: all.length ? 'changes-required' : 'configured', certificateStatus: 'unknown', contentVerified: false,
    records: dns.records, dnsOwnership: dns.dnsOwnership, workerBindings: bindings.workerBindings, pagesBindings: bindings.pagesBindings, routes: bindings.routes, changes: [...removals, ...additions] };
}

/** Sort keys and inventory arrays so API response ordering alone cannot invalidate consent. */
function canonical({ value }, _options = {}) {
  if (Array.isArray(value)) return value.map(item => canonical({ value: item })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical({ value: value[key] })]));
  return value;
}
function fingerprint({ details }, _options = {}) {
  return createHash('sha256').update(JSON.stringify(canonical({ value: details }))).digest('hex');
}

/** An approval is a server-held capability, never a serializable confirmed:true input.
 * Reinspection happens BEFORE uploads/provisioning, so stale/unknown plans cause zero mutations. */
export async function assertDomainApproval(input, _options = {}) {
  const { api, kit, approval } = input;
  if (typeof approval?.authorize !== 'function') throw refusal({ kit, code: 'CLOUDFLARE_DOMAIN_CONFIRMATION_REQUIRED', message: `Review the exact domain preview for ${input.domain} and confirm it through deployment_execute_static_publish in chat. A request flag cannot approve DNS or binding changes.`, status: 409 });
  const plan = await previewDomains(input);
  if (plan.inventoryStatus !== 'complete') throw refusal({ kit, code: 'CLOUDFLARE_INVENTORY_UNKNOWN', message: plan.message, status: 409 });
  if (approval.plan.fingerprint !== plan.fingerprint) throw refusal({ kit, code: 'CLOUDFLARE_DOMAIN_PLAN_STALE', message: `${input.domain} changed since review. Preview and confirm the new records, bindings and routes.`, status: 409 });
  if (!await approval.authorize({ fingerprint: plan.fingerprint, accountId: api.accountId })) throw refusal({ kit, code: 'CLOUDFLARE_DOMAIN_CONFIRMATION_REQUIRED', message: `Confirmation expired or does not match ${input.domain}. Preview and confirm again.`, status: 409 });
  return { ...plan, authorize: approval.authorize };
}

/** Apply only the verified, human-approved change list. No rollback or step journal by owner scope.
 * A failure remains partial and names all unfinished hostnames; rerun a fresh preview to resume. */
export async function applyDomains({ api, kit, plan, proof }, _options = {}) {
  try {
    if (typeof plan.authorize !== 'function' || !await plan.authorize({ fingerprint: plan.fingerprint, accountId: api.accountId })) {
      throw refusal({ kit, code: 'CLOUDFLARE_DOMAIN_CONFIRMATION_REQUIRED', message: `${plan.zone.name} needs a current human-confirmed preview. Preview and confirm again; no domain changes were applied.`, status: 409 });
    }
    // Uploads may take time. Verify the same approved write set again immediately before cutover.
    const current = await previewDomains({ api, kit, targetId: plan.targetId, resourceName: plan.resourceName, domain: plan.zone.name, zoneId: plan.zone.id });
    if (current.fingerprint !== plan.fingerprint) throw refusal({ kit, code: 'CLOUDFLARE_DOMAIN_PLAN_STALE', message: `${plan.zone.name} changed while hosting uploaded. Preview and confirm the new state; no domain changes were applied.`, status: 409 });
    for (const change of plan.changes) await applyChange({ api, kit, change });
    return await pollDomains({ api, kit, plan, proof });
  } catch (error) {
    return failedCutover({ api, kit, plan, proof, error });
  }
}

async function applyChange({ api, kit, change }, _options = {}) {
  if (change.method === 'DELETE' && change.path.includes('/dns_records/')) {
    // Detaching a Worker Custom Domain can remove its DNS record for us. Re-read the collection
    // instead of blindly deleting a now-missing record, or deleting an ID changed concurrently.
    const path = change.path.slice(0, change.path.lastIndexOf('/'));
    const records = await api.list({ path });
    const current = records.find(record => record.id === change.before.id);
    if (!current) return;
    if (fingerprint({ details: current }) !== fingerprint({ details: change.before })) throw refusal({ kit, code: 'CLOUDFLARE_DOMAIN_PLAN_STALE', message: `${change.hostname} DNS record ${change.before.id} changed during cutover. Preview and confirm again.`, status: 409 });
  }
  await api.request({ path: change.path, method: change.method, ...(change.body ? { body: change.body } : {}) });
}

async function failedCutover({ api, kit, plan, proof, error }, _options = {}) {
  let states;
  try { states = await pollDomains({ api, kit, plan, proof }, { attempts: 1 }); }
  catch { states = plan.hostnames.map(({ hostname }) => ({ hostname, certificateStatus: 'unknown', contentVerified: false })); }
  return states.map(state => ({ ...state, status: state.status === 'ready' ? 'ready' : 'failed', operationFailed: true, errorCode: error.code ?? 'CLOUDFLARE_DOMAIN_FAILED',
    message: `${state.hostname}: ${error.message} Hosting is retained. Preview again to inspect and resume the unfinished domain changes.` }));
}
