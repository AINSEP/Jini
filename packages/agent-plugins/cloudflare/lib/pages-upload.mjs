import { refusal, segment } from './api.mjs';
import { chunkUploads } from './assets.mjs';

/** Pages' stable project address, shared by render preparation and upload results. O(name bytes). */
export function pagesAddress({ resourceName }, _options = {}) { return `https://${resourceName}.pages.dev`; }

/** Retains project names, upload tokens, hash dedup/upsert and config-file form fields.
 * Root _headers/_redirects must be deployment fields: uploading them as assets serves them publicly
 * and never applies their rules (the Wrangler Pages deploy protocol does the same split).
 * @complexity O(unique assets + bytes) and bounded batches (100 files / 75 MiB encoded). */
/**
   * Root-level Pages config files that the direct-upload API takes as their own deployment form
   * fields rather than as assets (wrangler's `pages deploy` does the same and keeps them out of the
   * manifest). Uploaded as an asset instead, `_headers` would be served as a public file and its
   * rules never applied. Only the root copy is config; a nested `_headers` stays an ordinary asset.
   */
export async function uploadPages({ api, kit, resourceName, prepared }, _options = {}) {
  const path = `${api.accountPath}/pages/projects/${segment({ value: resourceName })}`;
  await ensureProject({ api, path, resourceName });
  const token = await api.request({ path: `${path}/upload-token` });
  if (!token.jwt) throw refusal({ kit, code: 'CLOUDFLARE_UPLOAD_TOKEN_REQUIRED', message: `Pages project ${resourceName} returned no upload token. Check Pages Edit permission and retry.`, status: 502 });
  await uploadAssets({ api, kit, prepared, jwt: token.jwt });
  const form = new FormData();
  form.append('manifest', JSON.stringify(Object.fromEntries(Object.entries(prepared.manifest).map(([path, file]) => [path, file.hash]))));
  form.append('branch', 'main');
  for (const [name, data] of Object.entries(prepared.config)) form.append(name, new File([data], name));
  const deployment = await api.request({ path: `${path}/deployments`, method: 'POST', body: form }, { timeoutMs: kit.timeouts.DEPLOY });
  return { url: pagesAddress({ resourceName }), deploymentId: deployment.id };
}

async function ensureProject({ api, path, resourceName }, _options = {}) {
  if (await api.request({ path }, { allowMissing: true })) return;
  try { await api.request({ path: `${api.accountPath}/pages/projects`, method: 'POST', body: { name: resourceName, production_branch: 'main' } }, { timeoutMs: api.kit.timeouts.DEPLOY }); }
  catch (error) {
    // A concurrent publisher can create the same stable project between GET and POST.
    if (error.status !== 409 && !error.details?.alreadyExists) throw error;
    await api.request({ path });
  }
}

async function uploadAssets({ api, kit, prepared, jwt }, _options = {}) {
  const hashes = [...prepared.byHash.keys()];
  const result = await api.request({ path: '/pages/assets/check-missing', method: 'POST', jwt, body: { hashes } });
  const missing = Array.isArray(result) ? result : result.hashes;
  if (!Array.isArray(missing)) throw refusal({ kit, code: 'CLOUDFLARE_ASSET_LOOKUP_INVALID', message: 'Pages returned an incomplete missing-assets list. Retry publishing.', status: 502 });
  const files = missing.map(hash => {
    const file = prepared.byHash.get(hash);
    if (!file) throw refusal({ kit, code: 'CLOUDFLARE_ASSET_BUCKET_INVALID', message: `Pages requested unknown asset hash ${hash}. Retry publishing.`, status: 502 });
    return file;
  });
  for (const batch of chunkUploads({ files })) {
    await api.request({ path: '/pages/assets/upload', method: 'POST', jwt, body: batch.map(file => ({ key: file.hash, value: file.data.toString('base64'), metadata: { contentType: file.contentType }, base64: true })) }, { timeoutMs: kit.timeouts.UPLOAD });
  }
  await api.request({ path: '/pages/assets/upsert-hashes', method: 'POST', jwt, body: { hashes } });
}
