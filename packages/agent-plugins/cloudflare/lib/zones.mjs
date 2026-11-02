import { refusal, segment, ZONES_PAGING } from './api.mjs';

/** Hostname validation is deliberately strict: no URL, wildcard, port or inferred parent zone. */
export function normalizeDomain({ domain, kit }, _options = {}) {
  const name = String(domain).trim().toLowerCase().replace(/\.$/, '');
  if (name.length > 253 || !name.includes('.') || !name.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw refusal({ kit, code: 'CLOUDFLARE_INVALID_DOMAIN', message: 'Enter the apex domain as a hostname (without https://, www prefix, port or path), then preview again.' });
  }
  return name;
}

/** Absorbs the old Pages zone discovery; verifies active full zone AND exact account ownership. */
export async function resolveZone({ api, domain, zoneId }, _options = {}) {
  const zones = zoneId ? [{ id: zoneId }] : await api.list({ path: `/zones?account.id=${segment({ value: api.accountId })}` }, ZONES_PAGING);
  const selected = zoneId ? zones[0] : zones.find(zone => zone.name === domain);
  if (!selected?.id) throw refusal({ kit: api.kit, code: 'CLOUDFLARE_ZONE_REQUIRED', message: `No accessible zone matches ${domain}. Add it to this Cloudflare account or select its Zone ID and grant Zone Read.` });
  const zone = await api.request({ path: `/zones/${segment({ value: selected.id })}` });
  assertSelectedZone({ api, zone, selected, domain });
  return { id: selected.id, name: zone.name };
}

function assertSelectedZone({ api, zone, selected, domain }, _options = {}) {
  if (zone?.name !== domain || zone.account?.id !== api.accountId) throw refusal({ kit: api.kit, code: 'CLOUDFLARE_ZONE_MISMATCH', message: `${domain} does not match zone ${selected.id} in account ${api.accountId}. Select the correct domain, account and Zone ID.` });
  if (zone.status !== 'active' || zone.type !== 'full') throw refusal({ kit: api.kit, code: 'CLOUDFLARE_ZONE_INACTIVE', message: `${domain} needs an active full Cloudflare DNS zone. Finish nameserver setup in Cloudflare, then preview again.` });
}
