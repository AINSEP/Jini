import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync, symlinkSync, unlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertClaudeFilesystemSupport, claudeFilesystemRuntimePaths, claudeFilesystemSettings, validateFilesystemLaunch } from '../../claude-filesystem-policy.js';
import { claudeAgentDef } from '../claude.js';
import { buildClaudeMcpConfigArgs } from '../shared.js';

// Owner decision 2026-10-23 / FS-REVIEW phase 1. Real filesystem canaries, no mocked containment.
const fixtures: string[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true }); });

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'filesystem-policy-'));
  fixtures.push(base);
  const site = join(base, 'site');
  const outside = join(base, 'site-other');
  mkdirSync(site); mkdirSync(outside);
  writeFileSync(join(site, 'inside.txt'), 'inside');
  writeFileSync(join(outside, 'outside-canary.txt'), 'OUTSIDE_CANARY_CONTENT');
  return { base, site, outside };
}

describe('host filesystem launch boundary', () => {
  it('permits the canonical site and in-site attachment directories', () => {
    const { site } = fixture();
    mkdirSync(join(site, 'uploads'));
    expect(validateFilesystemLaunch({ filesystemRoot: site, cwd: site, extraAllowedDirs: [join(site, 'uploads')] }, {})).toBe(realpathSync(site));
  });

  it('refuses absolute outside paths, parent traversal and a sibling with the same prefix', () => {
    const { site, outside } = fixture();
    for (const path of [outside, '..', '../site-other', join(outside, 'outside-canary.txt')]) {
      expect(() => validateFilesystemLaunch({ filesystemRoot: site, cwd: site, extraAllowedDirs: [path] }, {})).toThrow();
    }
    expect(() => validateFilesystemLaunch({ filesystemRoot: site, cwd: outside }, {})).toThrow();
    expect(() => validateFilesystemLaunch({ filesystemRoot: 'relative', cwd: site }, {})).toThrow();
    expect(() => validateFilesystemLaunch({ filesystemRoot: join(site, 'missing'), cwd: site }, {})).toThrow();
  });

  it.skipIf(process.platform === 'win32')('refuses external, broken and replaced symlinks', () => {
    const { site, outside } = fixture();
    const alias = join(site, 'alias');
    symlinkSync(site, alias);
    expect(validateFilesystemLaunch({ filesystemRoot: site, cwd: site, extraAllowedDirs: [alias] }, {})).toBe(realpathSync(site));
    unlinkSync(alias); symlinkSync(outside, alias);
    expect(() => validateFilesystemLaunch({ filesystemRoot: site, cwd: site, extraAllowedDirs: [alias] }, {})).toThrow();
    unlinkSync(alias); symlinkSync(join(outside, 'missing'), alias);
    expect(() => validateFilesystemLaunch({ filesystemRoot: site, cwd: site, extraAllowedDirs: [alias] }, {})).toThrow();
  });

  it('refuses outside images independently of the original directory list', () => {
    const { site, outside } = fixture();
    const imagePaths = [join(outside, 'outside-canary.txt')];
    expect(() => validateFilesystemLaunch({ filesystemRoot: site, cwd: site, extraAllowedDirs: [], imagePaths }, {})).toThrow();
  });
});

describe('Claude enforcement availability', () => {
  function executable() {
    const { base } = fixture();
    const launchPath = join(base, 'claude'); writeFileSync(launchPath, 'never executed');
    return launchPath;
  }

  it.each(['2.1.248 (Claude Code)', '2.1.284 (Claude Code)'])('reports known unsupported evidence: %s', async stdout => {
    const probe = vi.fn().mockResolvedValue({ stdout, stderr: '' });
    await expect(assertClaudeFilesystemSupport({ agentId: 'claude', launchPath: executable(), env: {} }, { probe })).resolves.toBe(false);
  });
  it.each(['2.1.285 (Claude Code)', '2.1.309 (Claude Code)', '3.0.0 (Claude Code)'])('accepts a supported official version: %s', async stdout => {
    const launchPath = executable();
    const probe = vi.fn().mockResolvedValue({ stdout, stderr: '' });
    await expect(assertClaudeFilesystemSupport({ agentId: 'claude', launchPath, env: {} }, { probe })).resolves.toBe(true);
    expect(probe).toHaveBeenCalledWith({ command: launchPath, args: ['--version'] }, { options: { env: {}, timeout: 5000 } });
  });
  it('reports unsupported providers and forks without probing or exposing outside canaries', async () => {
    const probe = vi.fn();
    for (const [agentId, launchPath] of [['codex', '/outside/CANARY/codex'], ['claude', '/outside/CANARY/openclaude']]) {
      expect(await assertClaudeFilesystemSupport({ agentId: agentId!, launchPath: launchPath!, env: {} }, { probe })).toBe(false);
    }
    expect(probe).not.toHaveBeenCalled();
  });
  it('shares concurrent probes by path/mtime and reprobes after the executable changes', async () => {
    const launchPath = executable();
    const probe = vi.fn().mockResolvedValue({ stdout: '2.1.309 (Claude Code)', stderr: '' });
    const required = { agentId: 'claude', launchPath, env: {} };
    expect(await Promise.all([assertClaudeFilesystemSupport(required, { probe }), assertClaudeFilesystemSupport(required, { probe })])).toEqual([true, true]);
    expect(probe).toHaveBeenCalledTimes(1);
    utimesSync(launchPath, new Date(1), new Date(1));
    expect(await assertClaudeFilesystemSupport(required, { probe })).toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });
  it.each(['timeout', 'unknown-output'])('retries %s once with a longer timeout and caches uncertainty without output', async scenario => {
    const probe = scenario === 'timeout' ? vi.fn().mockRejectedValue(new Error('OUTSIDE_CANARY_CONTENT'))
      : vi.fn().mockResolvedValue({ stdout: 'OUTSIDE_CANARY_NAME', stderr: 'OUTSIDE_CANARY_CONTENT' });
    const required = { agentId: 'claude', launchPath: executable(), env: {} };
    expect(await assertClaudeFilesystemSupport(required, { probe })).toBeUndefined();
    expect(await assertClaudeFilesystemSupport(required, { probe })).toBeUndefined();
    expect(probe.mock.calls.map(call => call[1].options.timeout)).toEqual([5000, 15000]);
  });
  it('recovers on the longer retry', async () => {
    const probe = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ stdout: '2.1.309 (Claude Code)', stderr: '' });
    expect(await assertClaudeFilesystemSupport({ agentId: 'claude', launchPath: executable(), env: {} }, { probe })).toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe('mandatory native launch settings', () => {
  it('retains shell/file tools while parity, user settings and supplied directories cannot widen the root', () => {
    const { site } = fixture();
    const args = claudeAgentDef.buildArgs({ prompt: 'hello', imagePaths: [] }, { extraAllowedDirs: [site], options: {
      filesystemRoot: site, cliParity: true, permissionMode: 'bypass', nativeToolAccess: true,
      nativeCapabilities: { shell: true, fileWrite: true, userSettings: true, userMcp: true, subagents: true },
      settingSources: ['user', 'project', 'local'],
      settings: JSON.stringify({ autoMemoryEnabled: true, permissions: { additionalDirectories: ['/outside'] },
        sandbox: { enabled: false, allowUnsandboxedCommands: true, excludedCommands: ['python'], filesystem: { disabled: true, allowRead: ['/'] } } }),
      disallowedTools: ['Bash', 'Read(//**/.tovu/**)'],
    }, runtimeContext: { cwd: site } });
    expect(args).not.toContain('--add-dir');
    // The boundary holds in every permission mode; dontAsk would deny Edit/Write and MCP tools.
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('bypassPermissions');
    expect(args).not.toContain('*');
    expect(args).not.toContain('--tools'); // Native tool availability is unchanged.
    expect(args).not.toContain('Bash');
    expect(args).toContain('Read(//**/.tovu/**)');
    expect(args).not.toContain('--strict-mcp-config');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]!);
    expect(settings.autoMemoryEnabled).toBe(false);
    expect(settings.permissions).toMatchObject({ blockReadsOutsideWorkingDirectories: true, additionalDirectories: [] });
    expect(settings.sandbox.excludedCommands).toEqual([]);
    expect(settings.sandbox.filesystem.allowRead).not.toContain('/');
    expect(settings.sandbox.filesystem.disabled).not.toBe(true);
  });

  it('requires sandbox availability on macOS/Linux and records the native Windows exception', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      const settings = JSON.parse(claudeFilesystemSettings({ options: { filesystemRoot: '/site', filesystemRuntimeReadPaths: ['/runtime/claude'] } }, {
        platform, homeDir: '/home/owner', tempDir: '/runtime/temp',
      }));
      expect(settings.sandbox.enabled).toBe(platform !== 'win32');
      expect(settings.sandbox.failIfUnavailable).toBe(platform !== 'win32');
      expect(settings.sandbox.allowUnsandboxedCommands).toBe(platform === 'win32');
      expect(settings.sandbox.filesystem).toEqual({ denyRead: ['/home/owner', '/tmp', '/private/tmp', '/runtime/temp'],
        allowRead: ['/site', '/site/.agent-runtime/tmp', '/home/owner/.gitconfig', '/home/owner/.config/git/config', '/runtime/claude'],
        allowWrite: ['/site', '/site/.agent-runtime/tmp'] });
      expect(settings.sandbox.network).toBeUndefined();
    }
  });
});

describe('explicit infrastructure exceptions', () => {
  it('allows only global git config reads under home, without a home write grant', () => {
    const settings = JSON.parse(claudeFilesystemSettings({ options: { filesystemRoot: '/site' } }, { homeDir: '/home/owner' }));
    const { allowRead, allowWrite, denyRead } = settings.sandbox.filesystem;
    expect(allowRead.filter((path: string) => path.startsWith('/home/owner'))).toEqual(['/home/owner/.gitconfig', '/home/owner/.config/git/config']);
    expect(allowWrite).not.toContain('/home/owner');
    expect(allowWrite).not.toContain('/home/owner/.gitconfig');
    expect(denyRead).toContain('/home/owner');
    expect(JSON.stringify(settings)).not.toContain('/home/owner/OUTSIDE_CANARY');
  });
  it('denies shared temp roots and grants only site/private temp writes', () => {
    const options = { filesystemRoot: '/site', filesystemTempDir: '/site/.agent-runtime/tmp-run', filesystemSharedTempRoots: ['/shared/login-temp'] };
    const settings = JSON.parse(claudeFilesystemSettings({ options }, { tempDir: '/shared/host-temp' }));
    const { allowRead, allowWrite, denyRead } = settings.sandbox.filesystem;
    expect(denyRead).toEqual(expect.arrayContaining(['/tmp', '/private/tmp', '/shared/host-temp', '/shared/login-temp']));
    expect(allowWrite).toEqual(['/site', options.filesystemTempDir]);
    for (const path of ['/tmp', '/private/tmp', '/private/tmp/claude-501', '/shared/host-temp', '/shared/login-temp']) {
      expect(allowRead).not.toContain(path); expect(allowWrite).not.toContain(path);
    }
    expect(JSON.stringify(settings)).not.toContain('OUTSIDE_CANARY');
  });
});

describe('personal configuration disclosure contract', () => {
  it('honors personal MCP ON while OFF and unspecified site grants stay strict', () => {
    for (const runtimeContext of [{}, { mcpJsonPath: '/site/.mcp.jini.json' }]) {
      for (const userMcp of [true, false, undefined]) {
        const args = buildClaudeMcpConfigArgs(runtimeContext, { filesystemRoot: '/site', cliParity: true,
          permissionMode: 'bypass', nativeToolAccess: true, nativeCapabilities: userMcp === undefined ? {} : { userMcp } });
        expect(args.includes('--strict-mcp-config')).toBe(userMcp !== true);
        expect(args.join(' ')).not.toContain('OUTSIDE_CANARY');
      }
    }
  });
  it('excludes personal settings even with the owner toggle ON, without disabling tools', () => {
    const { site } = fixture();
    const args = claudeAgentDef.buildArgs({ prompt: 'hello', imagePaths: [] }, { options: {
      filesystemRoot: site, permissionMode: 'bypass', nativeToolAccess: true,
      nativeCapabilities: { userSettings: true }, settingSources: ['user', 'project', 'local'],
    }, runtimeContext: { cwd: site } });
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(args).not.toContain('--disable-slash-commands');
    expect(args.join(' ')).not.toContain('OUTSIDE_CANARY');
  });
});

// Stryker L3 (2026-10-25): version-floor edges on major/minor, the missing-executable catch, the
// strict version regex, and claudeFilesystemRuntimePaths had no test.
describe('Claude enforcement availability — floor edges and fail-open paths', () => {
  function executable() {
    const { base } = fixture();
    const launchPath = join(base, 'claude'); writeFileSync(launchPath, 'never executed');
    return launchPath;
  }
  it.each([
    ['1.99.999 (Claude Code)', false], ['2.0.999 (Claude Code)', false], ['2.1.0 (Claude Code)', false],
    ['2.2.0 (Claude Code)', true], ['2.10.0 (Claude Code)', true], ['10.0.0 (Claude Code)', true],
    ['  2.1.285 (Claude Code)  \n', true],
  ])('floor 2.1.285: %j → %s', async (stdout, expected) => {
    const probe = vi.fn().mockResolvedValue({ stdout, stderr: '' });
    await expect(assertClaudeFilesystemSupport({ agentId: 'claude', launchPath: executable(), env: {} }, { probe })).resolves.toBe(expected);
  });
  it.each(['v2.1.300 (Claude Code)', '2.1.300 (Claude Code) beta', '2.1.300 (Claude)', '2.1 (Claude Code)', '2.1.300  Claude Code'])(
    'treats non-official version text %j as unknown (undefined), after two probes', async stdout => {
      const probe = vi.fn().mockResolvedValue({ stdout, stderr: '' });
      await expect(assertClaudeFilesystemSupport({ agentId: 'claude', launchPath: executable(), env: {} }, { probe })).resolves.toBeUndefined();
      expect(probe).toHaveBeenCalledTimes(2);
    });
  it('a launch path that cannot be stat-ed is unknown (undefined) and never probed', async () => {
    const probe = vi.fn();
    const { base } = fixture();
    await expect(assertClaudeFilesystemSupport({ agentId: 'claude', launchPath: join(base, 'missing-claude'), env: {} }, { probe })).resolves.toBeUndefined();
    expect(probe).not.toHaveBeenCalled();
  });
  it.each(['openclaude', 'OpenClaude.exe', 'openclaude.cmd'])('%s is an unsupported fork', async name => {
    const probe = vi.fn();
    await expect(assertClaudeFilesystemSupport({ agentId: 'claude', launchPath: `/x/${name}`, env: {} }, { probe })).resolves.toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
  it('openclaudex is NOT the fork and is probed', async () => {
    const { base } = fixture();
    const launchPath = join(base, 'openclaudex'); writeFileSync(launchPath, 'x');
    const probe = vi.fn().mockResolvedValue({ stdout: '2.1.300 (Claude Code)', stderr: '' });
    await expect(assertClaudeFilesystemSupport({ agentId: 'claude', launchPath, env: {} }, { probe })).resolves.toBe(true);
  });
});

describe('claudeFilesystemRuntimePaths', () => {
  it.each(['cli.js', 'cli.mjs', 'cli.cjs'])('a JS entrypoint (%s) grants its package directory, via a symlinked launcher', name => {
    const { base } = fixture();
    const pkg = join(base, 'pkg'); mkdirSync(pkg);
    const entry = join(pkg, name); writeFileSync(entry, '');
    const launcher = join(base, 'claude'); symlinkSync(entry, launcher);
    expect(claudeFilesystemRuntimePaths({ launchPath: launcher }, {})).toEqual([launcher, realpathSync(pkg), realpathSync(process.execPath)]);
  });
  it.each(['claude', 'claude.json', 'cli.jsx'])('a native binary (%s) grants only itself, deduplicated', name => {
    const { base } = fixture();
    const bin = join(realpathSync(base), name); writeFileSync(bin, '');
    expect(claudeFilesystemRuntimePaths({ launchPath: bin }, {})).toEqual([bin, realpathSync(process.execPath)]);
  });
});
