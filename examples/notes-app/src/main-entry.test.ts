import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const entry = fileURLToPath(new URL('./main.ts', import.meta.url));

test('importing the entry does not open a database or start a server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notes-import-'));
  try {
    const filePath = join(dir, 'untouched.db');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('./main.ts', import.meta.url).href)}); console.log('imported');`], {
      env: { ...process.env, NOTES_DB: filePath, PORT: '0' }, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'imported\n');
    assert.equal(existsSync(filePath), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI database and port take precedence over environment values', { timeout: 15_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'notes-entry-'));
  const filePath = join(dir, 'cli.db'), ignored = join(dir, 'env.db');
  const child = spawn(process.execPath, [entry, '--db', filePath, '--port', '0'], {
    env: { ...process.env, NOTES_DB: ignored, PORT: 'invalid-env-port' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  t.after(async () => { child.kill('SIGTERM'); await closed; rmSync(dir, { recursive: true, force: true }); });
  let output = '', errors = '';
  child.stderr.on('data', chunk => { errors += String(chunk); });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`entry exited ${code}: ${errors}`)));
    child.stdout.on('data', chunk => { output += String(chunk); if (/listening on http:\/\/127\.0\.0\.1:\d+/.test(output)) resolve(); });
  });
  assert.match(output, /listening on http:\/\/127\.0\.0\.1:[1-9]\d*/);
  assert.equal(existsSync(filePath), true);
  assert.equal(existsSync(ignored), false);
});
