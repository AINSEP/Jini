import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractOpenCodeServiceFailure,
  readLatestOpenCodeLogTail,
  readOpenCodeServiceFailure,
  resolveOpenCodeLogDir,
} from '../opencode-log.js';

describe('resolveOpenCodeLogDir', () => {
  it('prefers XDG_DATA_HOME when set', () => {
    expect(resolveOpenCodeLogDir({ env: { XDG_DATA_HOME: '/xdg/data', HOME: '/home/user' } })).toBe(
      path.join('/xdg/data', 'opencode', 'log'),
    );
  });

  it('falls back to $HOME/.local/share when XDG_DATA_HOME is unset', () => {
    expect(resolveOpenCodeLogDir({ env: { HOME: '/home/user' } })).toBe(
      path.join('/home/user', '.local', 'share', 'opencode', 'log'),
    );
  });

  it('trims whitespace-only env values', () => {
    expect(resolveOpenCodeLogDir({ env: { XDG_DATA_HOME: '   ', HOME: '/home/user' } })).toBe(
      path.join('/home/user', '.local', 'share', 'opencode', 'log'),
    );
  });

  it('returns null when neither XDG_DATA_HOME nor HOME is set', () => {
    expect(resolveOpenCodeLogDir({ env: {} })).toBeNull();
  });
});

describe('readLatestOpenCodeLogTail', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'opencode-log-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the log dir does not exist', () => {
    expect(readLatestOpenCodeLogTail({ logDir: path.join(dir, 'missing') })).toBeNull();
  });

  it('returns null when the dir has no .log files', () => {
    writeFileSync(path.join(dir, 'notes.txt'), 'hello', 'utf8');
    expect(readLatestOpenCodeLogTail({ logDir: dir })).toBeNull();
  });

  it('reads the lexicographically-newest .log file', () => {
    writeFileSync(path.join(dir, '2024-01-01.log'), 'old content', 'utf8');
    writeFileSync(path.join(dir, '2024-06-01.log'), 'new content', 'utf8');
    expect(readLatestOpenCodeLogTail({ logDir: dir })).toBe('new content');
  });

  it('truncates to the last maxBytes bytes when the file is larger', () => {
    writeFileSync(path.join(dir, '2024-01-01.log'), 'x'.repeat(100), 'utf8');
    const tail = readLatestOpenCodeLogTail({ logDir: dir }, { maxBytes: 10 });
    expect(tail).toBe('x'.repeat(10));
  });

  it('skips a file whose mtime is before `since`, falling back to an older-but-valid one', async () => {
    const older = path.join(dir, '2024-01-01.log');
    const newer = path.join(dir, '2024-06-01.log');
    writeFileSync(older, 'older content', 'utf8');
    writeFileSync(newer, 'newer content but too old for since', 'utf8');
    const oldTime = new Date('2020-01-01').getTime() / 1000;
    utimesSync(newer, oldTime, oldTime);
    utimesSync(older, oldTime, oldTime);
    const tail = readLatestOpenCodeLogTail({ logDir: dir }, { since: Date.now() });
    expect(tail).toBeNull();
  });

  it('skips a broken symlink (statSync throws inside the since-scoped guard) and continues to a real file', () => {
    const real = path.join(dir, '2024-01-01.log');
    writeFileSync(real, 'real content', 'utf8');
    // Sorts after the real file lexicographically, so it's tried first
    // (newest filename first); its statSync throws ENOENT since the link
    // target doesn't exist, which must be caught and treated as "skip".
    symlinkSync(path.join(dir, 'does-not-exist-target'), path.join(dir, '2024-06-01.log'));
    expect(readLatestOpenCodeLogTail({ logDir: dir }, { since: 0 })).toBe('real content');
  });

  it('returns the newest file whose mtime is at/after `since`', () => {
    const older = path.join(dir, '2024-01-01.log');
    const newer = path.join(dir, '2024-06-01.log');
    writeFileSync(older, 'older content', 'utf8');
    writeFileSync(newer, 'newer content', 'utf8');
    const since = Date.now() - 60_000;
    expect(readLatestOpenCodeLogTail({ logDir: dir }, { since })).toBe('newer content');
  });

  it('skips a file that errors on stat (since path) and continues to older files', () => {
    const real = path.join(dir, '2024-06-01.log');
    writeFileSync(real, 'real content', 'utf8');
    // Create then delete a "phantom" name that sorts newer, to force a
    // readdir hit followed by a stat/read miss on that same iteration.
    const phantomDir = path.join(dir, '2099-01-01.log');
    mkdirSync(phantomDir); // A directory named like a .log "file" — statSync succeeds but readFileSync on it throws.
    const tail = readLatestOpenCodeLogTail({ logDir: dir }, { since: 0 });
    expect(tail).toBe('real content');
  });
});

describe('extractOpenCodeServiceFailure', () => {
  it('returns null for empty/whitespace-only input', () => {
    expect(extractOpenCodeServiceFailure({ logTail: '' })).toBeNull();
    expect(extractOpenCodeServiceFailure({ logTail: '   ' })).toBeNull();
  });

  it('returns null when no line matches the service=llm ERROR error= shape', () => {
    expect(extractOpenCodeServiceFailure({ logTail: 'some unrelated log line\nanother line' })).toBeNull();
  });

  it('classifies a 401 statusCode as AGENT_AUTH_REQUIRED with a default message when none is extractable', () => {
    const line = 'INFO service=llm ERROR error={"statusCode":401}';
    const result = extractOpenCodeServiceFailure({ logTail: line });
    expect(result).toEqual({
      code: 'AGENT_AUTH_REQUIRED',
      message: 'OpenCode could not authenticate with the model provider.',
      statusCode: 401,
    });
  });

  it('classifies a 403 statusCode as AGENT_AUTH_REQUIRED', () => {
    const line = 'service=llm ERROR error={"statusCode":403}';
    expect(extractOpenCodeServiceFailure({ logTail: line })?.code).toBe('AGENT_AUTH_REQUIRED');
  });

  it('classifies a 429 statusCode as RATE_LIMITED', () => {
    const line = 'service=llm ERROR error={"statusCode":429}';
    const result = extractOpenCodeServiceFailure({ logTail: line });
    expect(result?.code).toBe('RATE_LIMITED');
    expect(result?.message).toBe('OpenCode hit a provider usage or rate limit.');
  });

  it('classifies a 5xx statusCode as UPSTREAM_UNAVAILABLE', () => {
    const line = 'service=llm ERROR error={"statusCode":503}';
    const result = extractOpenCodeServiceFailure({ logTail: line });
    expect(result?.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(result?.message).toBe("OpenCode's model provider is temporarily unavailable.");
  });

  it('returns null for a statusCode with no matching code and no usable message', () => {
    const line = 'service=llm ERROR error={"statusCode":200}';
    expect(extractOpenCodeServiceFailure({ logTail: line })).toBeNull();
  });

  it('falls back to keyword-based classification when statusCode is absent, using the extracted message', () => {
    const line = 'service=llm ERROR error={"message":"rate limit exceeded, please slow down"}';
    const result = extractOpenCodeServiceFailure({ logTail: line });
    expect(result?.code).toBe('RATE_LIMITED');
    expect(result?.message).toBe('rate limit exceeded, please slow down');
  });

  it('picks the last matching line among several candidate lines', () => {
    const logTail = [
      'service=llm ERROR error={"statusCode":429}',
      'some unrelated middle line',
      'service=llm ERROR error={"statusCode":500}',
    ].join('\n');
    expect(extractOpenCodeServiceFailure({ logTail: logTail })?.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('handles \\r\\n line endings', () => {
    const logTail = 'line one\r\nservice=llm ERROR error={"statusCode":401}\r\n';
    expect(extractOpenCodeServiceFailure({ logTail: logTail })?.code).toBe('AGENT_AUTH_REQUIRED');
  });

  it('prefers a message-derived code when statusCode does not map to a known code', () => {
    const line = 'service=llm ERROR error={"statusCode":200,"message":"invalid api key provided"}';
    const result = extractOpenCodeServiceFailure({ logTail: line });
    expect(result?.code).toBe('AGENT_AUTH_REQUIRED');
    expect(result?.message).toBe('invalid api key provided');
  });

  it('returns null when no candidate matches the keyword gate and there is no recognized statusCode', () => {
    const line = 'service=llm ERROR error={"message":"totally unrelated content"}';
    expect(extractOpenCodeServiceFailure({ logTail: line })).toBeNull();
  });

  it('SEC-002/CR-R2: a recognized statusCode (429) never surfaces an unrelated/attacker-controlled message — the code default is used instead', () => {
    // The regression this guards: a provider log line can embed the entire request body
    // (system prompt + tool schemas) under the same "message" key this parser scans. With a
    // recognized statusCode present, the code used to fall back to the FIRST non-matching
    // message value instead of the safe per-code default — masquerading unrelated payload
    // content as the service-failure reason.
    const line = 'service=llm ERROR error={"statusCode":429,"message":"totally unrelated attacker-controlled content"}';
    const result = extractOpenCodeServiceFailure({ logTail: line });
    expect(result?.code).toBe('RATE_LIMITED');
    expect(result?.message).toBe('OpenCode hit a provider usage or rate limit.');
    expect(result?.message).not.toContain('attacker-controlled');
  });

  it('SEC-002/CR-R2: a recognized statusCode (500) never leaks secret-shaped content embedded in an unrelated message value', () => {
    const line = 'service=llm ERROR error={"statusCode":500,"message":"leaked prompt: sk-secret-abc123"}';
    const result = extractOpenCodeServiceFailure({ logTail: line });
    expect(result?.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(result?.message).not.toContain('sk-secret-abc123');
  });

  it('unescapes a JSON-escaped message value', () => {
    const line = String.raw`service=llm ERROR error={"message":"quota \"exceeded\" for today"}`;
    const result = extractOpenCodeServiceFailure({ logTail: line });
    expect(result?.message).toBe('quota "exceeded" for today');
  });

  it('falls back to the raw match text when the JSON.parse of the message fails', () => {
    // An unterminated/invalid escape sequence that JSON.parse rejects.
    const line = 'service=llm ERROR error={"message":"bad \\u escape rate limit"}';
    const result = extractOpenCodeServiceFailure({ logTail: line });
    expect(result).not.toBeNull();
  });
});

describe('readOpenCodeServiceFailure', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'opencode-log-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the log dir cannot be resolved', () => {
    expect(readOpenCodeServiceFailure({ env: {} })).toBeNull();
  });

  it('returns null when there is no tail to read', () => {
    expect(readOpenCodeServiceFailure({ env: { HOME: path.join(dir, 'nonexistent-home') } })).toBeNull();
  });

  it('resolves the log dir from env, reads the tail, and classifies it end-to-end', () => {
    const logDir = path.join(dir, '.local', 'share', 'opencode', 'log');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(path.join(logDir, '2024-01-01.log'), 'service=llm ERROR error={"statusCode":429}', 'utf8');
    const result = readOpenCodeServiceFailure({ env: { HOME: dir } });
    expect(result?.code).toBe('RATE_LIMITED');
  });
});
