import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createLocalNodeDaemon, type LocalNodeDaemon } from '../create-local-node-daemon.js';

/**
 * The order of the layers in front of the daemon's routes, per security profile, recorded from
 * today's preset on a real socket. Which of "who are you" and "is this JSON" is asked first is
 * a security fact (an unauthenticated caller either can or cannot make the server parse a body),
 * and it differs between the two profiles, so each is written down as it is.
 */

const TOKEN_ENV = 'HOST_ORDER_CHARACTERIZATION_TOKEN';
const TOKEN = 'host-order-characterization-secret';
const MALFORMED = '{"broken"';

const tempDirs: string[] = [];
const daemons: LocalNodeDaemon[] = [];
afterEach(async () => {
  while (daemons.length > 0) await daemons.pop()?.stop().catch(() => undefined);
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
  delete process.env[TOKEN_ENV];
});

function openSqlite(file: string, settings: Database.Options = {}): Database.Database { return new Database(file, settings); }

async function startDaemon(security: Parameters<typeof createLocalNodeDaemon>[0]['security']): Promise<LocalNodeDaemon> {
  process.env[TOKEN_ENV] = TOKEN;
  const dataDir = mkdtempSync(join(tmpdir(), 'jini-host-order-'));
  tempDirs.push(dataDir);
  const daemon = await createLocalNodeDaemon({ open: openSqlite, dataDir, packs: [], ...(security ? { security } : {}) });
  daemons.push(daemon);
  return daemon;
}

/** One request with Node's own client, which (unlike `fetch`) will send a body with a GET. */
function send({ daemon, method, path, body, headers = {} }: { daemon: LocalNodeDaemon; method: string; path: string; body?: string; headers?: Record<string, string> }): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(`${daemon.url}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }), ...headers } }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      incoming.on('end', () => { resolve({ status: incoming.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }); });
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

const OVERSIZED = JSON.stringify({ pad: 'x'.repeat(200 * 1024) });
const profiles = [
  ['sidecar-strict', { mode: 'sidecar-strict', tokenEnvVar: TOKEN_ENV }],
  ['jini-local', { mode: 'jini-local', apiToken: { tokenEnvVar: TOKEN_ENV } }],
] as const;

describe.each(profiles)('%s', (mode, security) => {
  it('health answers 200 to a caller with no token, even one sending a body over the parser limit', async () => {
    const daemon = await startDaemon(security as never);
    expect((await send({ daemon, method: 'GET', path: '/api/health' })).status).toBe(200);
    expect((await send({ daemon, method: 'GET', path: '/api/health', body: OVERSIZED })).status).toBe(200);
  });

  it('a caller with the token and malformed JSON is refused by the parser with 400', async () => {
    const daemon = await startDaemon(security as never);
    const answer = await send({ daemon, method: 'POST', path: '/api/agents/rescan', body: MALFORMED, headers: { authorization: `Bearer ${TOKEN}` } });
    expect(answer.status).toBe(400);
  });

  it('a body over the parser limit (100 KB) from a caller with the token is refused with 413', async () => {
    const daemon = await startDaemon(security as never);
    const answer = await send({ daemon, method: 'POST', path: '/api/agents/rescan', body: OVERSIZED, headers: { authorization: `Bearer ${TOKEN}` } });
    expect(answer.status).toBe(413);
  });

  if (mode === 'sidecar-strict') {
    it('a caller with no token and malformed JSON is refused with 401: the token is asked for before the body is parsed', async () => {
      const daemon = await startDaemon(security as never);
      const answer = await send({ daemon, method: 'POST', path: '/api/agents/rescan', body: MALFORMED });
      expect(answer.status).toBe(401);
      expect(answer.text).not.toContain('SyntaxError');
    });

    it('a caller with no token and an oversized body is refused with 401, not 413', async () => {
      const daemon = await startDaemon(security as never);
      expect((await send({ daemon, method: 'POST', path: '/api/agents/rescan', body: OVERSIZED })).status).toBe(401);
    });
  } else {
    it('a caller with no token and malformed JSON is refused with 400: the body is parsed before any token check', async () => {
      const daemon = await startDaemon(security as never);
      const answer = await send({ daemon, method: 'POST', path: '/api/agents/rescan', body: MALFORMED });
      expect(answer.status).toBe(400);
    });

    it('a caller with no token and an oversized body is refused with 413: the body is read before any token check', async () => {
      const daemon = await startDaemon(security as never);
      expect((await send({ daemon, method: 'POST', path: '/api/agents/rescan', body: OVERSIZED })).status).toBe(413);
    });
  }
});
