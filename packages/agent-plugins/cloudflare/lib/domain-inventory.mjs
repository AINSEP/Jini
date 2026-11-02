import { segment, refusal, PAGES_PROJECTS_PAGING } from './api.mjs';
import { matchesHostname } from './dns.mjs';

/** Full account inventory, including disabled/no-script bindings. Never filter by destination first.
 * @complexity At most 100 pages/list and 100 Pages projects; refuse beyond the cap, never truncate. */
export async function readDomainInventory({ api, zone }, _options = {}) {
  const records = await api.list({ path: `/zones/${segment({ value: zone.id })}/dns_records` });
  const workers = await api.list({ path: `${api.accountPath}/workers/domains` });
  const routes = await api.list({ path: `/zones/${segment({ value: zone.id })}/workers/routes` });
  const projects = await api.list({ path: `${api.accountPath}/pages/projects` }, PAGES_PROJECTS_PAGING);
  requireFields({ api, rows: records, fields: ['id', 'name', 'type', 'content'], label: 'DNS records' });
  requireFields({ api, rows: workers, fields: ['id', 'hostname', 'service', 'environment'], label: 'Worker domains' });
  requireFields({ api, rows: routes, fields: ['id', 'pattern'], label: 'Worker routes' });
  requireFields({ api, rows: projects, fields: ['name'], label: 'Pages projects' });
  if (projects.length > 100) throw refusal({ kit: api.kit, code: 'CLOUDFLARE_INVENTORY_UNKNOWN', message: 'More than 100 Pages projects need conflict inspection. Narrow the account or contact support before changing domains.' });
  const pages = [];
  for (const project of projects) {
    const domains = await api.list({ path: `${api.accountPath}/pages/projects/${segment({ value: project.name })}/domains` }, PAGES_PROJECTS_PAGING);
    requireFields({ api, rows: domains, fields: ['name', 'status'], label: `Pages project ${project.name} domains` });
    pages.push(...domains.map(domain => ({ ...domain, projectName: project.name })));
  }
  return { records, workers, routes, pages };
}

function requireFields({ api, rows, fields, label }, _options = {}) {
  const complete = rows.every(row => fields.every(field => typeof row?.[field] === 'string' && row[field].length > 0));
  if (!complete) throw refusal({ kit: api.kit, code: 'CLOUDFLARE_INVENTORY_UNKNOWN', message: `${label} returned incomplete identities. Check read permissions and preview again before changing domains.`, status: 409 });
  if (new Set(rows.map(row => row[fields[0]])).size !== rows.length) throw refusal({ kit: api.kit, code: 'CLOUDFLARE_INVENTORY_UNKNOWN', message: `${label} changed while paginating (repeated identities). Preview again before changing domains.`, status: 409 });
}

/** Current state and exact binding/route effects for one hostname; a route can affect BOTH names. */
export function planBindings({ inventory, hostname, targetId, resourceName, zone, accountPath }, _options = {}) {
  const workerBindings = inventory.workers.filter(binding => binding.hostname === hostname);
  const pagesBindings = inventory.pages.filter(binding => binding.name === hostname);
  const routes = inventory.routes.filter(route => matchesHostname({ pattern: route.pattern, hostname }));
  const workers = workerBindings.filter(binding => targetId !== 'cloudflare-workers' || binding.service !== resourceName || binding.environment !== 'production' || binding.enabled === false);
  const pages = pagesBindings.filter(binding => targetId !== 'cloudflare-pages' || binding.projectName !== resourceName);
  const changes = [
    ...workers.map(binding => ({ method: 'DELETE', path: `${accountPath}/workers/domains/${segment({ value: binding.id })}`, hostname, before: binding, reason: `Detach ${hostname} from Worker ${binding.service}.` })),
    ...pages.map(binding => ({ method: 'DELETE', path: `${accountPath}/pages/projects/${segment({ value: binding.projectName })}/domains/${segment({ value: hostname })}`, hostname, before: binding, reason: `Detach ${hostname} from Pages project ${binding.projectName}.` })),
    ...routes.map(route => ({ method: 'DELETE', path: `/zones/${segment({ value: zone.id })}/workers/routes/${segment({ value: route.id })}`, hostname, before: route, widerImpact: true, reason: `Remove entire overlapping route ${route.pattern} (${route.id}); this can affect other hostnames and paths. No automatic splitting.` })),
  ];
  const owned = targetId === 'cloudflare-workers'
    ? workerBindings.some(binding => binding.service === resourceName && binding.environment === 'production' && binding.enabled !== false)
    : pagesBindings.some(binding => binding.projectName === resourceName);
  if (!owned) changes.push(attachment({ targetId, resourceName, zone, accountPath, hostname }));
  if (owned && targetId === 'cloudflare-pages') changes.push(...pagesValidationRetry({ pagesBindings, resourceName, hostname, accountPath }));
  return { workerBindings, pagesBindings, routes, changes, owned };
}

function pagesValidationRetry({ pagesBindings, resourceName, hostname, accountPath }, _options = {}) {
  const current = pagesBindings.find(binding => binding.projectName === resourceName);
  if (current.status === 'active') return [];
  return [{ method: 'PATCH', path: `${accountPath}/pages/projects/${segment({ value: resourceName })}/domains/${segment({ value: hostname })}`, hostname, before: current,
    reason: `Retry ${current.status} domain validation for ${hostname} on Pages project ${resourceName}.` }];
}

function attachment({ targetId, resourceName, zone, accountPath, hostname }, _options = {}) {
  if (targetId === 'cloudflare-workers') return { method: 'PUT', path: `${accountPath}/workers/domains`, hostname, body: { hostname, service: resourceName, environment: 'production', zone_id: zone.id }, reason: `Attach ${hostname} to Worker ${resourceName}; Cloudflare manages DNS and certificates.` };
  return { method: 'POST', path: `${accountPath}/pages/projects/${segment({ value: resourceName })}/domains`, hostname, body: { name: hostname }, reason: `Associate ${hostname} with Pages project ${resourceName} before creating its CNAME.` };
}
