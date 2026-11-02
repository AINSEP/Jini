import { createHash } from 'node:crypto';
import { segment } from './api.mjs';

/** A stable identifier stamped as a Cloudflare DNS record comment so a later publish can recognize
 * (and safely patch) a CNAME record it created itself, versus one an operator manages by hand.
 * Genericized from the OD origin's od:cfp: marker prefix. Keep existing Pages markers byte-identical. */
/**
   * A stable identifier stamped as a Cloudflare DNS record comment so a later
   * publish can recognize (and safely patch) a CNAME record it created
   * itself, versus one an operator manages by hand. Genericized from the OD
   * origin's `od:cfp:` marker prefix.
   */
export function dnsMarker({ resourceName, targetHost }, _options = {}) {
  const short = ({ value }, _options = {}) => createHash('sha256').update(value).digest('hex').slice(0, 12);
  return `jini-deploy:${short({ value: resourceName })}:${short({ value: targetHost })}`;
}

export function matchesHostname({ pattern, hostname }, _options = {}) {
  const hostPattern = pattern.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  const expression = hostPattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${expression}$`).test(hostname);
}

/** Include mail/TXT/CAA in the review, but change only conflicting address records.
 * Wildcard records are disclosed and preserved: exact hostname records override their DNS match. */
export function planDns({ records, hostname, targetId, resourceName, zoneId, preserveWorkerDns }, _options = {}) {
  const targetHost = `${resourceName}.pages.dev`;
  const relevant = records.filter(record => matchesHostname({ pattern: record.name, hostname }) || (record.type === 'CAA' && hostname.endsWith(`.${record.name}`)));
  // A Custom Domain already on this Worker owns its origin DNS. Never tear down that binding's
  // managed address records merely because they are not Pages-style CNAMEs.
  if (preserveWorkerDns) return { records: relevant, changes: [], dnsOwnership: 'worker-managed' };
  const addresses = relevant.filter(record => record.name === hostname && ['A', 'AAAA', 'CNAME'].includes(record.type));
  const exact = targetId === 'cloudflare-pages' && addresses.find(record => record.type === 'CNAME' && record.content.replace(/\.$/, '') === targetHost);
  const path = `/zones/${segment({ value: zoneId })}/dns_records`;
  const changes = addresses.filter(record => record !== exact).map(record => ({ method: 'DELETE', path: `${path}/${segment({ value: record.id })}`, hostname, before: record, reason: `Replace ${record.type} record ${record.id} for ${hostname}.` }));
  if (targetId === 'cloudflare-pages' && !exact) changes.push({ method: 'POST', path, hostname, body: { type: 'CNAME', name: hostname, content: targetHost, proxied: true, ttl: 1, comment: dnsMarker({ resourceName, targetHost }) }, reason: `Point ${hostname} to ${targetHost}; Cloudflare flattens the apex CNAME.` });
  return { records: relevant, changes, dnsOwnership: exact?.comment === dnsMarker({ resourceName, targetHost }) ? 'marked' : 'unmarked' };
}
