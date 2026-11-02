import { createHash } from 'node:crypto';
import { refusal } from './api.mjs';

/** Stable Pages/Workers dedup key; native crypto avoids a native/WASM dependency.
 * Retains Pages' historical data+extension hash so existing uploads stay deduplicated. */
/**
   * Deterministic content hash used purely as Cloudflare Pages' per-asset
   * dedup key (the direct-upload protocol needs a stable 32-hex-char key per
   * file, not a specific algorithm). Swapped from the OD origin's
   * `blake3-wasm` to Node's built-in `crypto` so this package carries no
   * native/WASM dependency — see `source-map.md`.
   */
export function assetHash({ file, data }, _options = {}) {
  const extension = file.includes('.') ? file.slice(file.lastIndexOf('.') + 1) : '';
  return createHash('sha256').update(`${Buffer.from(data).toString('base64')}${extension}`).digest('hex').slice(0, 32);
}

/** Root _headers/_redirects are configuration, never public assets. A nested copy remains an asset.
 * Host security headers replace the site's root _headers because they are host policy.
 * @complexity O(n + bytes) time and space; n is capped by the selected hosting plan. */
export function prepareAssets({ files, responseHeaders, kit }, { maxFiles = 20_000 } = {}) {
  const normalized = files.map(file => ({ ...file, file: file.file.replaceAll('\\', '/').replace(/^\.\//, '') }));
  const headers = responseHeaders && Object.keys(responseHeaders).length > 0;
  const supplied = headers ? [...normalized.filter(file => file.file !== '_headers'), { file: '_headers', data: renderHeaders({ headers: responseHeaders }) }] : normalized;
  if (supplied.length > maxFiles) throw refusal({ kit, code: 'CLOUDFLARE_ASSET_COUNT_LIMIT', message: `${supplied.length} files exceed this destination's ${maxFiles}-file limit (including generated files). Reduce the export or explicitly select a supported paid Workers plan.` });
  const manifest = {};
  const byHash = new Map();
  const config = {};
  for (const file of supplied) addAsset({ file, manifest, byHash, config, kit });
  return { manifest, byHash, config };
}

function addAsset({ file, manifest, byHash, config, kit }, _options = {}) {
  if (!file.file || file.file.startsWith('/') || file.file.split('/').includes('..')) throw refusal({ kit, code: 'CLOUDFLARE_ASSET_PATH', message: `Export path ${file.file} must be relative without '..'. Fix the export and retry.` });
  const data = Buffer.from(file.data);
  if (data.length > 25 * 1024 * 1024) throw refusal({ kit, code: 'CLOUDFLARE_ASSET_SIZE_LIMIT', message: `${file.file} exceeds 25 MiB. Resize the file and export again.` });
  if (file.file === '_headers' || file.file === '_redirects') { config[file.file] = data.toString('utf8'); return; }
  const path = `/${file.file}`;
  if (Object.hasOwn(manifest, path)) throw refusal({ kit, code: 'CLOUDFLARE_ASSET_PATH', message: `Duplicate export path ${path}. Fix the export and retry.` });
  const hash = assetHash({ file: file.file, data });
  manifest[path] = { hash, size: data.length };
  byHash.set(hash, { hash, data, contentType: file.contentType ?? 'application/octet-stream' });
}

export function renderHeaders({ headers }, _options = {}) {
  const lines = Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`).join('\n');
  return `/*\n${lines}\n`;
}

/** Respect both Pages limits. A single oversize request is refused before any upload.
 * @complexity O(n) over unique missing assets; at most 100 per request. */
export function chunkUploads({ files }, { maxFiles = 100, maxBytes = 75 * 1024 * 1024 } = {}) {
  const chunks = [];
  let chunk = [];
  let bytes = 2; // JSON array brackets.
  for (const file of files) {
    const size = Math.ceil(file.data.length / 3) * 4 + Buffer.byteLength(file.contentType) + file.hash.length + 128;
    if (size + 2 > maxBytes) throw new Error('CLOUDFLARE_UPLOAD_LIMIT: One asset cannot fit in the upload request. Reduce its size.');
    if (chunk.length >= maxFiles || bytes + size > maxBytes) { chunks.push(chunk); chunk = []; bytes = 2; }
    chunk.push(file);
    bytes += size;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
