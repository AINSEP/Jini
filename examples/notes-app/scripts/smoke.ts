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

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
}

const post = (base: string, path: string, fields: Record<string, string>) =>
  fetch(base + path, { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' });

try {
  const first = await start();
  const created = await post(first.base, '/notes', { title: 'First note', slug: 'first', body: 'hello' });
  check(created.status === 303, `create note -> 303 (got ${created.status})`);
  const edited = await post(first.base, '/notes/first/edit', { title: 'First note (edited)', body: 'hello, edited', version: '1' });
  check(edited.status === 303, `edit note -> 303 (got ${edited.status})`);
  const published = await post(first.base, '/notes/first/publish', {});
  check(published.status === 303, `publish note -> 303 (got ${published.status})`);
  const page = await (await fetch(`${first.base}/notes/first`)).text();
  check(page.includes('data-form="contact"') && page.includes('action="/forms/contact?note=first"'), 'detail page renders the contact form');
  const sent = await post(first.base, '/forms/contact?note=first', { name: 'Ada', email: 'ada@example.com', message: 'Nice note' });
  check(sent.status === 303 && sent.headers.get('location') === '/notes/first?sent=1', `submit contact form -> 303 (got ${sent.status})`);
  check((await fetch(`${first.base}/nope`)).status === 404, 'unknown path -> 404');
  check((await fetch(`${first.base}/notes`)).status === 405, 'wrong method -> 405');
  await stop(first.child);

  const second = await start();
  const { notes } = await (await fetch(`${second.base}/api/notes`)).json() as { notes: Array<{ slug: string; title: string; body: string; status: string }> };
  const note = notes.find((n) => n.slug === 'first');
  check(note?.title === 'First note (edited)' && note.body === 'hello, edited', 'after restart: note keeps its edit');
  check(note?.status === 'published', 'after restart: note is published');
  const { submissions } = await (await fetch(`${second.base}/api/forms/contact/submissions`)).json() as { submissions: Array<{ data: Record<string, unknown> }> };
  check(submissions.length === 1 && submissions[0]?.data.message === 'Nice note', 'after restart: contact submission is listed');
  check((await (await fetch(`${second.base}/`)).text()).includes('First note (edited)'), 'after restart: list page shows the note');
  await stop(second.child);
  console.log('PASS');
} catch (error) {
  console.log(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await Promise.all(children.map(stop));
  rmSync(dir, { recursive: true, force: true });
}
