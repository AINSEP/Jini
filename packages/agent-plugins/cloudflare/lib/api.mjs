/** Cloudflare-only HTTP owner. All network effects use the injected, traced host transport. */
export const API_ROOT = 'https://api.cloudflare.com/client/v4';
export const segment = ({ value }, _options = {}) => encodeURIComponent(value);
/** Cloudflare rejects `per_page` above 10 on the Pages projects list (error 8000024, HTTP 400). */
export const PAGES_PROJECTS_PAGING = { perPage: 10, maxPages: 11 };
/** Cloudflare caps `per_page` at 50 on the zones list (the default 100 is refused). */
export const ZONES_PAGING = { perPage: 50, maxPages: 20 };

/** Safe, stable refusal; upstream bodies can contain credentials and never cross this boundary. */
export function refusal({ kit, code, message, status = 400 }, _options = {}) {
  const error = new kit.DeployError(`${code}: ${message}`, status, { errorCode: code });
  error.code = code;
  return error;
}

function nextStep({ status }, _options = {}) {
  if (status === 401 || status === 403) return 'Check the token permissions and account/zone scope in the Cloudflare skill, then preview again.';
  if (status === 429) return 'Cloudflare is rate limiting this account. Wait, then preview again.';
  return 'Check the named resource in Cloudflare, then preview again.';
}

/** Bind credential and HTTP once. Requests never follow redirects with a bearer token. */
export function createApi({ credential, kit }, _options = {}) {
  if (!credential.token || !credential.accountId) throw refusal({ kit, code: 'CLOUDFLARE_CREDENTIAL_REQUIRED', message: 'Save a Cloudflare API token and Account ID in the secure connection form.' });
  const accountPath = `/accounts/${segment({ value: credential.accountId })}`;
  async function response({ path, method = 'GET', body, jwt }, options = {}) {
    const init = requestInit({ method, body, token: jwt ?? credential.token });
    let resp;
    try { resp = await kit.fetch(`${API_ROOT}${path}`, init, { timeoutMs: options.timeoutMs ?? kit.timeouts.QUICK }); }
    catch { throw refusal({ kit, code: 'CLOUDFLARE_UNREACHABLE', message: `${method} ${path} could not reach Cloudflare. Check your connection and retry.`, status: 502 }); }
    if (options.allowMissing && resp.status === 404) return { missing: true };
    return decodeResponse({ resp, method, path, kit });
  }
  async function request(input, options = {}) {
    const json = await response(input, options);
    if (json.missing) return null;
    return json.result ?? json;
  }
  async function list({ path }, { maxPages = 100, perPage = 100 } = {}) {
    const items = [];
    let pagination = { count: 0, pages: 0 };
    for (let page = 1; page <= maxPages; page += 1) {
      const separator = path.includes('?') ? '&' : '?';
      const json = await response({ path: `${path}${separator}page=${page}&per_page=${perPage}` });
      if (!Array.isArray(json.result)) throw refusal({ kit, code: 'CLOUDFLARE_INVENTORY_UNKNOWN', message: `${path} did not return a complete list. Check read permissions and preview again.`, status: 502 });
      items.push(...json.result);
      pagination = paginationState({ previous: pagination, info: json.result_info });
      if (items.length > maxPages * perPage) throw refusal({ kit, code: 'CLOUDFLARE_INVENTORY_UNKNOWN', message: `${path} exceeded the inventory item limit. Narrow the account and preview again.`, status: 409 });
      const more = hasNextPage({ info: json.result_info, page, perPage, count: json.result.length });
      assertCompletePage({ kit, path, pagination, itemCount: items.length, lastCount: json.result.length, more });
      if (!more) return items;
    }
    throw refusal({ kit, code: 'CLOUDFLARE_INVENTORY_UNKNOWN', message: `${path} exceeded the ${maxPages}-page inventory limit. Narrow the account scope or contact support; no domain changes are safe.`, status: 409 });
  }
  return { request, list, accountPath, accountId: credential.accountId, zoneId: credential.zoneId, kit };
}

function paginationState({ previous, info }, _options = {}) {
  return { count: Math.max(previous.count, Number(info?.total_count) || 0), pages: Math.max(previous.pages, Number(info?.total_pages) || 0) };
}
function assertCompletePage({ kit, path, pagination, itemCount, lastCount, more }, _options = {}) {
  if ((!more && itemCount < pagination.count) || (lastCount === 0 && pagination.pages > 1)) throw refusal({ kit, code: 'CLOUDFLARE_INVENTORY_UNKNOWN', message: `${path} returned an incomplete inventory page. Refresh read permissions and preview again; no domain changes are safe.`, status: 409 });
}

async function decodeResponse({ resp, method, path, kit }, _options = {}) {
  let json;
  try { json = await resp.json(); }
  catch { throw refusal({ kit, code: 'CLOUDFLARE_INVALID_RESPONSE', message: `${method} ${path} returned unreadable data. Retry; if it persists check Cloudflare status.`, status: 502 }); }
  if (json === null || typeof json !== 'object') throw refusal({ kit, code: 'CLOUDFLARE_INVALID_RESPONSE', message: `${method} ${path} returned no usable response object. Retry the request and check Cloudflare status.`, status: 502 });
  if (!resp.ok || json?.success === false) throw apiFailure({ kit, json, method, path, status: resp.status });
  return json;
}

function apiFailure({ kit, json, method, path, status }, _options = {}) {
  const error = refusal({ kit, code: 'CLOUDFLARE_API_ERROR', message: `${method} ${path} failed (HTTP ${status}). ${nextStep({ status })}`, status });
  // Classify duplicate creation races without returning Cloudflare's potentially secret-bearing text.
  const errors = Array.isArray(json.errors) ? json.errors : [];
  error.details.alreadyExists = errors.some(item => /already exist|already bound|already been taken|already in use|duplicate/i.test(String(item?.message)));
  return error;
}

function requestInit({ method, body, token }, _options = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  const init = { method, headers, redirect: 'error' };
  if (body === undefined) return init;
  if (body instanceof FormData) init.body = body;
  else { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  return init;
}

/** Empty pages before a reported end are incomplete, not evidence of absence. */
function hasNextPage({ info, page, perPage, count }, _options = {}) {
  if (Number.isFinite(info?.total_pages)) return page < info.total_pages;
  if (Number.isFinite(info?.total_count)) return page * (info.per_page ?? perPage) < info.total_count;
  return count >= perPage;
}
