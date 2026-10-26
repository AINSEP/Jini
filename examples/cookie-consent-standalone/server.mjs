/** Standalone @jini-ai/cookie-consent on plain node:http: a rendered banner, the browser client, durable receipts
 * in ./receipts, and a fake vendor whose script arrives late to show queueing. Run: npm start (build the package first). */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBanner } from '@jini-ai/cookie-consent/render';
import { handleReceipt } from '@jini-ai/cookie-consent/server';
import { createConsentFileRecords, createNodeConsentFiles } from '@jini-ai/cookie-consent/node';

const PORT = Number(process.env.PORT ?? 4321);
const POLICY = '2026-10-26';
const here = path.dirname(fileURLToPath(import.meta.url));
const clientFile = fileURLToPath(import.meta.resolve('@jini-ai/cookie-consent/client.min.js'));
/** The fake vendor's script is held back this long, so a visitor can choose before (or after) it arrives. */
const VENDOR_DELAY_MS = 2000;

// A real host binds its own crash-safe writer; a plain write is enough for a demo.
const atomicWrite = async ({ filePath, data }, { createParent, mode }) => {
  if (createParent) await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data), { mode, flag: 'wx' });
};
const store = createConsentFileRecords({ directory: path.join(here, 'receipts'), files: createNodeConsentFiles({ atomicWrite }) });
const ports = { store, policy: () => POLICY, ids: () => crypto.randomUUID(), now: Date.now };

function page() {
  const { head, body, problems } = renderBanner(
    { mode: 'jini', client: { contract: 1, policy: POLICY, regionMode: 'auto' }, copy: { privacyPolicyUrl: '/privacy' } },
    { clientSrc: '/consent/client.min.js', evidence: { mode: 'durable', endpoint: '/_consent' }, customCss: '#jini-consent h2{font-size:18px}' },
  );
  if (problems.length) console.warn('banner CSS problems:', problems);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cookie consent demo</title>${head}</head>
<body><h1>Cookie consent demo</h1>
<p>Consent: <output id="state">loading</output></p>
<p>Fake vendor: <output id="vendor">script not loaded yet</output></p>
<p><a href="#privacy-choices">Privacy choices</a></p>
<script type="text/plain" data-consent-category="marketing">document.title += ' (marketing tag ran)';</script>
<script src="/fake-vendor.js" async></script>
<script>document.addEventListener('jini:consent', e => { document.getElementById('state').value = JSON.stringify(e.detail.allowed) + ' receipt=' + e.detail.receipt; });</script>
${body}</body></html>`;
}

/** node:http -> web Request. A real host builds the URL from its public origin so the origin check means something. */
async function toRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
}

async function send(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

createServer(async (req, res) => {
  const reply = (type, text) => { res.writeHead(200, { 'content-type': type }); res.end(text); };
  try {
    if (req.url === '/_consent') return await send(res, await handleReceipt({ request: await toRequest(req), ports }));
    if (req.url === '/consent/client.min.js') return reply('text/javascript', await readFile(clientFile));
    if (req.url === '/fake-vendor.js') {
      await new Promise(r => setTimeout(r, VENDOR_DELAY_MS));
      return reply('text/javascript', await readFile(path.join(here, 'fake-vendor.js')));
    }
    if (req.url === '/' || req.url === '/privacy') return reply('text/html; charset=utf-8', page());
    res.writeHead(404); res.end();
  } catch (error) {
    console.error(error);
    res.writeHead(500); res.end();
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
