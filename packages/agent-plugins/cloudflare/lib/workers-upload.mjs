import { refusal, segment } from './api.mjs';
import { workersAddress } from './target.mjs';

/** Pinned protocol date: advance with release acceptance, never silently use today's date. */
export const COMPATIBILITY_DATE = '2026-10-01';
const MODULE = 'export default { fetch(request, env) { return env.ASSETS.fetch(request); } };';

/** Server buckets are authoritative. Sequential upload bounds concurrency to one request.
 * @complexity O(files + bytes) hashing/encoding and one request per nonempty server bucket. */
export async function uploadWorker({ api, kit, resourceName, prepared, forms }, _options = {}) {
  const url = await workersAddress({ api, kit, resourceName });
  const scriptPath = `${api.accountPath}/workers/scripts/${segment({ value: resourceName })}`;
  const session = await api.request({ path: `${scriptPath}/assets-upload-session`, method: 'POST', body: { manifest: prepared.manifest } });
  if (!session.jwt || !Array.isArray(session.buckets) || session.buckets.some(bucket => !Array.isArray(bucket))) throw refusal({ kit, code: 'CLOUDFLARE_ASSET_BUCKET_INVALID', message: `Worker ${resourceName} returned an invalid upload session. Preview and retry.`, status: 502 });
  const jwt = await uploadBuckets({ api, kit, session, prepared });
  const form = scriptForm({ jwt, config: prepared.config, forms });
  const result = await api.request({ path: scriptPath, method: 'PUT', body: form }, { timeoutMs: kit.timeouts.DEPLOY });
  await api.request({ path: `${scriptPath}/subdomain`, method: 'POST', body: { enabled: true, previews_enabled: false } });
  return { url, deploymentId: result.id };
}

/** Assets-only script, or (with `forms`) the receiver modules, D1 and key bindings, and Worker-first form routes. */
export function scriptForm({ jwt, config, forms }, _options = {}) {
  const modules = forms?.modules ?? [{ name: 'index.mjs', source: MODULE }];
  const assetsConfig = { html_handling: 'auto-trailing-slash', not_found_handling: '404-page', ...config, ...(forms ? { run_worker_first: forms.runWorkerFirst } : {}) };
  const form = new FormData();
  form.append('metadata', JSON.stringify({ main_module: 'index.mjs', compatibility_date: COMPATIBILITY_DATE, bindings: [{ type: 'assets', name: 'ASSETS' }, ...(forms?.bindings ?? [])], assets: { jwt, config: assetsConfig } }));
  for (const module of modules) form.append(module.name, new File([module.source], module.name, { type: 'application/javascript+module' }));
  return form;
}

async function uploadBuckets({ api, kit, session, prepared }, _options = {}) {
  const nonempty = session.buckets.filter(bucket => bucket.length > 0);
  if (nonempty.length === 0) return session.jwt;
  let completion;
  for (const bucket of nonempty) {
    const form = new FormData();
    for (const hash of bucket) {
      const file = prepared.byHash.get(hash);
      if (!file) throw refusal({ kit, code: 'CLOUDFLARE_ASSET_BUCKET_INVALID', message: `Cloudflare requested unknown asset hash ${hash}. Do not upload; preview and retry.`, status: 502 });
      form.append(hash, new File([file.data.toString('base64')], hash, { type: file.contentType }));
    }
    const result = await api.request({ path: `${api.accountPath}/workers/assets/upload?base64=true`, method: 'POST', jwt: session.jwt, body: form }, { timeoutMs: kit.timeouts.UPLOAD });
    if (result.jwt) completion = result.jwt;
  }
  if (!completion) throw refusal({ kit, code: 'CLOUDFLARE_UPLOAD_INCOMPLETE', message: 'Worker asset upload returned no completion token. Retry publishing; the script has not been changed.', status: 502 });
  return completion;
}
