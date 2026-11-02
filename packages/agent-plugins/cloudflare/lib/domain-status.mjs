import { segment } from './api.mjs';

/** Bounded polling with injected clock/sleep and policy-enforcing HTTPS content transport.
 * At most 6 rounds; unfinished TLS/content is partial even if the hosting URL is ready. */
export async function pollDomains({ api, kit, plan, proof }, { attempts = 6 } = {}) {
  let states = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    states = [];
    const workers = plan.targetId === 'cloudflare-workers' ? await workerState({ api, plan }) : null;
    for (const { hostname } of plan.hostnames) states.push(await safeProbeHostname({ api, kit, plan, proof, hostname, workers }));
    if (states.every(state => state.status === 'ready')) return states;
    if (attempt + 1 < attempts) await kit.sleep(Math.min(1000 * 2 ** attempt, 8000));
  }
  return states;
}

async function safeProbeHostname(input, _options = {}) {
  try { return await probeHostname(input); }
  catch (error) { return { hostname: input.hostname, status: 'unknown', certificateStatus: 'unknown', contentVerified: false,
    errorCode: error.code ?? 'CLOUDFLARE_DOMAIN_STATUS_UNKNOWN', message: `${input.hostname}: ${error.message} Check domain validation and read permissions in Cloudflare, then preview again.` }; }
}

async function workerState({ api, plan }, _options = {}) {
  const bindings = await api.list({ path: `${api.accountPath}/workers/domains` });
  const certificates = await api.request({ path: `/zones/${segment({ value: plan.zone.id })}/ssl/certificate_packs` });
  // The certificate-packs list result is the array of packs; anything else proves no coverage.
  return { bindings, certificates: Array.isArray(certificates) ? certificates : [] };
}

async function probeHostname({ api, kit, plan, proof, hostname, workers }, _options = {}) {
  const state = workers ? workerHostnameState({ workers, plan, hostname }) : await pagesHostnameState({ api, plan, hostname });
  const verified = state.active && typeof kit.probeContent === 'function' && await kit.probeContent({ url: `https://${hostname}${proof.path}`, expected: proof.expected });
  return { hostname, url: `https://${hostname}`, status: verified ? 'ready' : 'pending', certificateStatus: state.certificateStatus, domainStatus: state.domainStatus ?? 'pending', contentVerified: Boolean(verified), message: verified ? `${hostname} serves the deployed content over HTTPS.` : `${hostname} is awaiting domain validation, certificate or deployed content. Recheck in Cloudflare, then preview and publish again to resume.` };
}

function workerHostnameState({ workers, plan, hostname }, _options = {}) {
  const active = workers.bindings.some(binding => binding.hostname === hostname && binding.service === plan.resourceName && binding.environment === 'production' && binding.enabled !== false);
  const certificate = workers.certificates.find(pack => pack.status === 'active' && pack.hosts?.some(host => certificateMatches({ host, hostname })));
  return { active: active && Boolean(certificate), domainStatus: active ? 'active' : 'pending', certificateStatus: certificate ? 'active' : 'pending' };
}
function certificateMatches({ host, hostname }, _options = {}) {
  if (host === hostname) return true;
  return host.startsWith('*.') && hostname.split('.').length === host.split('.').length && hostname.endsWith(host.slice(1));
}
async function pagesHostnameState({ api, plan, hostname }, _options = {}) {
  const domain = await api.request({ path: `${api.accountPath}/pages/projects/${segment({ value: plan.resourceName })}/domains/${segment({ value: hostname })}` });
  return { active: domain.status === 'active', domainStatus: domain.status, certificateStatus: domain.status === 'active' ? 'active' : 'pending' };
}
