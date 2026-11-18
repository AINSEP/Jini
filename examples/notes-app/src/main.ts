/**
 * @file Entry point: `node src/main.ts [--db path] [--port n] [--admin-dir path]`, or `NOTES_DB` / `PORT`.
 * `--admin-dir` is the built admin app served under `/admin/` (default: `../notes-web/dist`).
 * Prints `listening on http://127.0.0.1:<port>` once ready; stops on SIGINT/SIGTERM.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openAppDatabase } from './db.ts';
import { createNodeServer } from './node-server.ts';
import { registerNotesApp } from './app.ts';
import { serveAdminBundle } from './admin-bundle.ts';

const { values } = parseArgs({ options: { db: { type: 'string' }, port: { type: 'string' }, 'admin-dir': { type: 'string' } } });
const filePath = resolve(values.db ?? process.env.NOTES_DB ?? './data/notes.db');
const port = Number(values.port ?? process.env.PORT ?? 3000);
const adminDir = resolve(values['admin-dir'] ?? fileURLToPath(new URL('../../notes-web/dist', import.meta.url)));

const database = await openAppDatabase({ filePath });
const app = createNodeServer({}, { onUnmatched: ({ request }) => serveAdminBundle({ request }, { dir: adminDir }) });
let boundPort = 0;
await registerNotesApp({ app, kernel: database.kernel, port: () => boundPort });
const listening = await app.listen({ port });
boundPort = listening.port;
console.log(`listening on http://127.0.0.1:${listening.port}`);

const stop = async () => {
  await app.close();
  database.close();
  process.exit(0);
};
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
