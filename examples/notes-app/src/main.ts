/**
 * @file Entry point: `node src/main.ts [--db path] [--port n]`, or `NOTES_DB` / `PORT`.
 * Prints `listening on http://127.0.0.1:<port>` once ready; stops on SIGINT/SIGTERM.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openAppDatabase } from './db.ts';
import { createNodeServer } from './node-server.ts';
import { registerNotesApp } from './app.ts';

const { values } = parseArgs({ options: { db: { type: 'string' }, port: { type: 'string' } } });
const filePath = resolve(values.db ?? process.env.NOTES_DB ?? './data/notes.db');
const port = Number(values.port ?? process.env.PORT ?? 3000);

const database = await openAppDatabase({ filePath });
const app = createNodeServer();
await registerNotesApp({ app, kernel: database.kernel });
const listening = await app.listen({ port });
console.log(`listening on http://127.0.0.1:${listening.port}`);

const stop = async () => {
  await app.close();
  database.close();
  process.exit(0);
};
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
