/**
 * @file Restart proof. Starts the app on a free port against a temp DB, creates + edits + publishes
 * a note, submits the contact form, stops the process, starts it again on the same DB file, and
 * checks over HTTP that everything is still there. Prints PASS or FAIL; exit code matches.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mainPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main.ts');
const dir = mkdtempSync(join(tmpdir(), 'notes-smoke-'));
const dbPath = join(dir, 'notes.db');
const children: ChildProcess[] = [];

function start(): Promise<{ base: string; child: ChildProcess }> {
  const child = spawn(process.execPath, [mainPath, '--db', dbPath, '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  return new Promise((resolve, reject) => {
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const match = /listening on (http:\/\/\S+)/.exec(out);
      if (match?.[1]) resolve({ base: match[1], child });
    });
    child.once('exit', (code) => reject(new Error(`app exited early with ${code}: ${out}`)));
  });
}

function stop({ child }: { child: ChildProcess }, _optional: Record<string, never> = {}): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

function check({ condition, message }: { condition: unknown; message: string }, _optional: Record<string, never> = {}): void {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
}

const post = ({ base, path, fields }: { base: string; path: string; fields: Record<string, string> }, _optional: Record<string, never> = {}) =>
  fetch(base + path, { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' });

try {
  const first = await start();
  const created = await post({ base: first.base, path: '/notes', fields: { title: 'First note', slug: 'first', body: 'hello' } });
  check({ condition: created.status === 303, message: `create note -> 303 (got ${created.status})` });
  const edited = await post({ base: first.base, path: '/notes/first/edit', fields: { title: 'First note (edited)', body: 'hello, edited', version: '1' } });
  check({ condition: edited.status === 303, message: `edit note -> 303 (got ${edited.status})` });
  const published = await post({ base: first.base, path: '/notes/first/publish', fields: {} });
  check({ condition: published.status === 303, message: `publish note -> 303 (got ${published.status})` });
  const page = await (await fetch(`${first.base}/notes/first`)).text();
  check({ condition: page.includes('data-form="contact"') && page.includes('action="/forms/contact?note=first"'), message: 'detail page renders the contact form' });
  const sent = await post({ base: first.base, path: '/forms/contact?note=first', fields: { name: 'Ada', email: 'ada@example.com', message: 'Nice note' } });
  check({ condition: sent.status === 303 && sent.headers.get('location') === '/notes/first?sent=1', message: `submit contact form -> 303 (got ${sent.status})` });
  check({ condition: (await fetch(`${first.base}/nope`)).status === 404, message: 'unknown path -> 404' });
  check({ condition: (await fetch(`${first.base}/notes`)).status === 405, message: 'wrong method -> 405' });
  await stop({ child: first.child });

  const second = await start();
  const { notes } = await (await fetch(`${second.base}/api/notes`)).json() as { notes: Array<{ slug: string; title: string; body: string; status: string }> };
  const note = notes.find((n) => n.slug === 'first');
  check({ condition: note?.title === 'First note (edited)' && note.body === 'hello, edited', message: 'after restart: note keeps its edit' });
  check({ condition: note?.status === 'published', message: 'after restart: note is published' });
  const { submissions } = await (await fetch(`${second.base}/api/forms/contact/submissions`)).json() as { submissions: Array<{ data: Record<string, unknown> }> };
  check({ condition: submissions.length === 1 && submissions[0]?.data.message === 'Nice note', message: 'after restart: contact submission is listed' });
  check({ condition: (await (await fetch(`${second.base}/`)).text()).includes('First note (edited)'), message: 'after restart: list page shows the note' });
  await stop({ child: second.child });
  console.log('PASS');
} catch (error) {
  console.log(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await Promise.all(children.map((child) => stop({ child })));
  rmSync(dir, { recursive: true, force: true });
}
