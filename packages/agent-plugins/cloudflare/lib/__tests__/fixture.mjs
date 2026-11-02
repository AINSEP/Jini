/** Same shape as the host kit's `DeployError` (`@jini-ai/devops/deploy`): message, `status`, `details`.
 * Local so this plugin's suite runs without the host's devops package; the code under test only
 * constructs it through `kit.DeployError` and reads `message`, `status` and `code`. */
class FakeDeployError extends Error {
  constructor(message, status = 400, details) {
    super(message);
    this.name = 'DeployError';
    this.status = status;
    this.details = details;
  }
}

/** A fake of the real installed-plugin ABI (the host's deploy kit), with an explicit request transcript. */
export function fixture({ respond }, _options = {}) {
  const calls = [];
  let milliseconds = 0;
  const kit = {
    async fetch(url, init, options) {
      calls.push({ url, init, options });
      return respond({ url: new URL(url), init, index: calls.length });
    },
    timeouts: { QUICK: 100, DEPLOY: 100, UPLOAD: 100 },
    sleep: async ms => { milliseconds += ms; },
    checkDeploymentUrl: async () => ({ reachable: true, status: 'ready' }),
    waitForReachableDeploymentUrl: async urls => ({ url: String(urls[0]), status: 'ready', statusMessage: 'Ready' }),
    safeDnsLabel: raw => String(raw).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    safeProjectLabel: (raw, max) => String(raw).slice(0, max),
    normalizeDeploymentUrl: raw => String(raw),
    redirectGuardInit: init => ({ ...init, redirect: 'manual' }),
    assertNotRedirected: () => {},
    createSigV4Client: () => { throw new Error('Cloudflare must not use SigV4'); },
    DeployError: FakeDeployError,
  };
  return { calls, kit: { ...kit, now: () => milliseconds, probeContent: async () => true }, advance: ms => { milliseconds += ms; } };
}

export const json = (result, status = 200, extra = {}) => Response.json({ success: status < 400, result, ...extra }, { status });
export const credential = { token: 'secret-test-token', accountId: 'account' };
export const zone = { id: 'zone', name: 'example.com', status: 'active', type: 'full', account: { id: 'account' } };

/** First matching [path suffix | RegExp, method | null, handler] row answers; keeps fakes flat. */
export function routes(rows, fallback = ({ url }) => { throw new Error(`Unexpected ${url}`); }) {
  return request => {
    const row = rows.find(([path, method]) => matchesPath({ path, pathname: request.url.pathname }) && (!method || (request.init.method ?? 'GET') === method));
    return row ? row[2](request) : fallback(request);
  };
}
function matchesPath({ path, pathname }) { return path instanceof RegExp ? path.test(pathname) : pathname.endsWith(path); }

/** Default complete inventory, including explicit result_info for finite pagination. */
export function inventory(request, options = {}) {
  if ((request.init.method ?? 'GET') !== 'GET') throw new Error(`Preview wrote ${request.url}`);
  return routes(inventoryRows(options), ({ url }) => { throw new Error(`Unexpected inventory read ${url}`); })(request);
}
function inventoryRows(options) {
  return [
    ['/zones/zone', null, () => json(zone)],
    ['/zones', null, () => json([zone])],
    ['/workers/subdomain', null, () => json({ subdomain: 'my-account' })],
    ['/workers/scripts', null, () => json([])],
    ['/dns_records', null, () => json(options.records ?? [])],
    ['/workers/domains', null, () => json(options.workers ?? [])],
    ['/workers/routes', null, () => json(options.routes ?? [])],
    ['/pages/projects', null, () => json(options.projects ?? [])],
    ['/domains', null, () => json(options.domains ?? [])],
  ];
}
