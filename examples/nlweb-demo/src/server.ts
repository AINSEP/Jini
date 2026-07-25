/**
 * A minimal NLWeb-shaped server: `POST /ask` and `GET /ask?q=`.
 *
 * Node's built-in http on purpose — no framework, so the whole spike is readable end to end and
 * nothing about it is load-bearing on a dependency choice. Roughly 60 lines is the point: the
 * protocol surface is small, and the real work is retrieval.
 *
 * Run: `pnpm --dir examples/nlweb-demo start`
 * Try: `curl -s 'http://127.0.0.1:4319/ask?q=how+often+do+i+water+the+plants' | python3 -m json.tool`
 */
import { createServer } from 'node:http';
import { ask } from './ask.js';
import { SITE_ITEMS } from './items.js';

const PORT = Number(process.env['NLWEB_DEMO_PORT'] ?? 4319);
/** Bounded so a long body cannot be used to exhaust memory. */
const MAX_BODY_BYTES = 8_192;

async function readQuestion(request: import('node:http').IncomingMessage, url: URL): Promise<string> {
  if (request.method === 'GET') return url.searchParams.get('q') ?? '';
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return '';
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error('body must be a JSON object');
  const question = (parsed as { question?: unknown; q?: unknown }).question
    ?? (parsed as { q?: unknown }).q;
  return typeof question === 'string' ? question : '';
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    const send = (status: number, body: unknown) => {
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(body, null, 2));
    };

    if (url.pathname !== '/ask') {
      send(404, { error: 'not found', hint: 'POST /ask {"question": "..."} or GET /ask?q=...' });
      return;
    }

    try {
      const question = await readQuestion(request, url);
      send(200, await ask(SITE_ITEMS, question));
    } catch (error) {
      // A blank question is a caller error, not a server fault — say which.
      send(400, { error: error instanceof Error ? error.message : String(error) });
    }
  })();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`nlweb-demo listening on http://127.0.0.1:${PORT}/ask (${SITE_ITEMS.length} items)`);
});
