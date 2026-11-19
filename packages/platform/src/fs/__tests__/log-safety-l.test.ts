import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createConsoleLogger, type LogDiagnosticRecord } from '@jini-ai/core/primitives';
import { createDurableJsonFile, createNodeDurableJsonPorts } from '../durable-json.js';
import { createNodeDirectoryWorkspace } from '../directory-workspace.js';
import { selectWorkspaceDirectory } from '../workspace-directory.js';
import { createMailPolicyWrapper } from '../../mail/delivery-wrapper.js';
import { fixture, SEND, ACCEPTED, deferred } from '../../mail/__tests__/resolver-fixtures.js';
import { createConsoleMailProvider } from '../../mail/builtin-providers.js';
import type { OutboundEmail } from '../../mail/types.js';

it.each([false, true])('keeps corrupt bytes when quarantine failure=%s and reports once safely', refused => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'log-safety-l-'));
  const filePath = path.join(root, 'store.json');
  const raw = '{"PRIVATE_CORRUPT_SENTINEL"';
  const failure = new Error('PRIVATE_QUARANTINE_SENTINEL');
  failure.stack = 'PRIVATE_QUARANTINE_STACK_SENTINEL';
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const diagnostics: LogDiagnosticRecord[] = [];
  const ports = createNodeDurableJsonPorts({}, { report: createConsoleLogger({ prefix: '' }, { diagnostics: record => diagnostics.push(record) }) });
  const file = createDurableJsonFile({ ...ports, clock: { nowMs: () => 7 }, filesystem: { ...fs, renameSync: (from, to) => { if (refused) throw failure; return fs.renameSync(from, to); } }, filePath,
    notices: { prefix: 'Store', lockTimeout: () => 'locked' } });
  try {
    fs.writeFileSync(filePath, raw);
    expect(file.read({})).toEqual({ state: 'unreadable', text: raw });
    expect(file.quarantine({ notice: { label: 'settings', consequence: 'Using defaults.' } })).toBe(!refused);
    expect(fs.readFileSync(refused ? filePath : `${filePath}.corrupt-7`, 'utf8')).toBe(raw);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(diagnostics).toHaveLength(1);
    if (refused) expect(diagnostics[0]!.error).toBe(failure);
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/PRIVATE_(CORRUPT|QUARANTINE)(_STACK)?_SENTINEL/);
  } finally { errors.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); }
});

it.each([false, true])('forwards the workspace report with custom ports=%s without overwriting user config', customPorts => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'log-safety-l-config-'));
  const appDataDir = path.join(root, 'app');
  const filePath = path.join(appDataDir, 'config.json');
  const error = vi.fn();
  try {
    fs.mkdirSync(appDataDir); fs.writeFileSync(filePath, '{"PRIVATE_USER_CONFIG_SENTINEL"');
    const workspace = createNodeDirectoryWorkspace({ homeDir: root, defaultFolder: 'Sites', envName: 'TEST_HOME', settingsFile: path.join(root, 'settings.json'), registryName: 'registry.json', runningName: 'running.json', userConfig: { appName: 'Test', rootsEnvName: 'TEST_ROOTS' } }, { env: {}, platform: 'linux', appDataDir, report: { error }, ...(customPorts ? { ports: createNodeDurableJsonPorts({}, { report: { error: () => { throw new Error('workspace report override was dropped'); } } }) } : {}) });
    expect(workspace.home({})).toContain('Sites');
    expect(error).toHaveBeenCalledExactlyOnceWith({ message: `User config is unreadable: ${filePath}. Using defaults; the original was left untouched.` });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{"PRIVATE_USER_CONFIG_SENTINEL"');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it('reports duplicate directory selection once while preserving root preference', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const entries = ['/root/site', '/other/site'].map((dir, index) => ({ id: `site-${index}`, path: dir, name: 'site', createdBy: 'test', lastOpened: null }));
  try {
    expect(selectWorkspaceDirectory({ home: '/home', entries, fallback: '/fallback', selected: 'site', roots: ['/root'], listDirectories: () => [], isInitialized: () => false })).toBe('/root/site');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('/root/site (site-0)');
    expect(warn.mock.calls[0]![0]).toContain('/other/site (site-1)');
  } finally { warn.mockRestore(); }
});

it('preserves accepted mail and warns once when activity observation fails', async () => {
  const host = fixture();
  const accepted = host.provider.create({ credential: { token: 'key' }, kit: { httpClient: host.deps.httpClient } });
  const failure = new Error('PRIVATE_ACTIVITY_SENTINEL');
  failure.stack = 'PRIVATE_ACTIVITY_STACK_SENTINEL';
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const observe = vi.fn(async () => { throw failure; });
  const wrapped = createMailPolicyWrapper({ ledger: { reserve: async () => ({ status: 'reserved' }), mark: async () => {} }, suppression: { isSuppressed: async () => false, suppress: async () => {} }, readTestMode: async () => ({ mode: 'off' }), resendPolicy: () => 'on_unknown', observe })({ providerId: 'api', provider: host.provider, mailer: accepted });
  try {
    expect(await wrapped.send(SEND)).toBe(ACCEPTED);
    expect(await wrapped.send({ ...SEND, idempotencyKey: 'second' })).toBe(ACCEPTED);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(host.sends).toHaveLength(2);
    expect(warn).toHaveBeenCalledExactlyOnceWith('[mail] activity observation failed');
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/PRIVATE_ACTIVITY_(STACK_)?SENTINEL/);
  } finally { warn.mockRestore(); }
});

it('retains mail status after credential-list failure and reports the original only to diagnostics', async () => {
  const host = fixture();
  const failure = new Error('PRIVATE_CREDENTIAL_LIST_SENTINEL');
  failure.stack = 'PRIVATE_CREDENTIAL_LIST_STACK_SENTINEL';
  host.deps.listCredentialFacts = vi.fn(async () => { throw failure; });
  const diagnostics: LogDiagnosticRecord[] = [];
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const control = host.create({ report: createConsoleLogger({ prefix: '' }, { diagnostics: record => diagnostics.push(record) }) });
  try {
    await control.ready;
    const status = await control.status();
    expect(status.lastError).toMatchObject({ providerId: null, source: 'check', message: 'The provider configuration check could not complete.' });
    expect(host.deps.listCredentialFacts).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledExactlyOnceWith('[mail] the saved mail credentials could not be listed', 'Error');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.error).toBe(failure);
    expect(JSON.stringify([status, error.mock.calls])).not.toMatch(/PRIVATE_CREDENTIAL_LIST_(STACK_)?SENTINEL/);
    expect(await control.mailer.send(SEND)).toBe(ACCEPTED);
    expect(host.sends).toHaveLength(1);
  } finally { error.mockRestore(); }
});

it('requires a host preview that receives usable mail before a local receipt succeeds', async () => {
  const clock = { nowMs: () => 0 };
  // @ts-expect-error The explicit host preview is required even for development.
  expect(() => createConsoleMailProvider({ clock })).toThrow('A local mail preview callback is required.');
  const preview = vi.fn((_required: { message: OutboundEmail }) => {});
  const provider = createConsoleMailProvider({ clock, preview });
  const mailer = provider.create({ credential: { token: '' }, kit: { httpClient: fixture().deps.httpClient } });
  const message = { ...SEND.message, text: 'Sign in: https://example.test/sign-in?token=USABLE_PREVIEW_TOKEN' };
  expect(await mailer.send({ ...SEND, message })).toEqual({ ok: true, providerMessageId: 'console-1', acceptedAt: '1970-01-01T00:00:00.000Z' });
  expect(preview).toHaveBeenCalledExactlyOnceWith({ message });
  expect(preview.mock.calls[0]![0].message).toBe(message);
  const failure = new Error('preview unavailable');
  const refusing = createConsoleMailProvider({ clock, preview: async () => { throw failure; } }).create({ credential: { token: '' }, kit: { httpClient: fixture().deps.httpClient } });
  await expect(refusing.send(SEND)).rejects.toBe(failure);
});

it('keeps local receipt identities distinct when previews complete out of order', async () => {
  const firstPreview = deferred<void>();
  let previews = 0;
  const provider = createConsoleMailProvider({ clock: { nowMs: () => 0 }, preview: () => ++previews === 1 ? firstPreview.promise : undefined });
  const mailer = provider.create({ credential: { token: '' }, kit: { httpClient: fixture().deps.httpClient } });
  const first = mailer.send(SEND);
  const second = await mailer.send({ ...SEND, idempotencyKey: 'second' });
  firstPreview.resolve(undefined);
  expect(await first).toMatchObject({ ok: true, providerMessageId: 'console-1' });
  expect(second).toMatchObject({ ok: true, providerMessageId: 'console-2' });
  expect(previews).toBe(2);
});
