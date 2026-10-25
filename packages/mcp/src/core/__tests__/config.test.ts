import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  inferMcpAuthModeForUrl,
  sanitizeMcpServer,
  sanitizeMcpConfig,
  readMcpConfig,
  writeMcpConfig,
  isManagedProjectCwd,
  buildClaudeMcpJson,
  buildAcpMcpServers,
  buildOpenCodeMcpConfigContent,
  type McpServerConfig,
} from '../index.js';

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jini-mcp-cfg-'));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('inferMcpAuthModeForUrl / loopback detection', () => {
  it('returns oauth when the url is absent', () => {
    expect(inferMcpAuthModeForUrl({ rawUrl: undefined })).toBe('oauth');
  });
  it('treats loopback targets as none', () => {
    expect(inferMcpAuthModeForUrl({ rawUrl: 'http://localhost:3000' })).toBe('none');
    expect(inferMcpAuthModeForUrl({ rawUrl: 'http://127.0.0.1:8080' })).toBe('none');
    expect(inferMcpAuthModeForUrl({ rawUrl: 'http://[::1]:8080' })).toBe('none');
  });
  it('treats remote hosts as oauth', () => {
    expect(inferMcpAuthModeForUrl({ rawUrl: 'https://mcp.example.com' })).toBe('oauth');
  });
  it('falls back to oauth on an unparseable url', () => {
    expect(inferMcpAuthModeForUrl({ rawUrl: '::: not a url' })).toBe('oauth');
  });
});

describe('sanitizeMcpServer', () => {
  it('rejects non-objects and bad ids', () => {
    expect(sanitizeMcpServer({ raw: null })).toBeNull();
    expect(sanitizeMcpServer({ raw: { id: 'has space', transport: 'stdio', command: 'x' } })).toBeNull();
    expect(sanitizeMcpServer({ raw: { transport: 'stdio', command: 'x' } })).toBeNull();
  });
  it('rejects an invalid transport', () => {
    expect(sanitizeMcpServer({ raw: { id: 'a', transport: 'carrier-pigeon', command: 'x' } })).toBeNull();
  });
  it('defaults transport to stdio and enabled to true, keeps a trimmed label', () => {
    const s = sanitizeMcpServer({ raw: { id: 'a', command: 'node', label: '  My Server  ' } });
    expect(s).toMatchObject({ id: 'a', transport: 'stdio', enabled: true, command: 'node', label: 'My Server' });
  });
  it('honors enabled:false and drops an empty label', () => {
    const s = sanitizeMcpServer({ raw: { id: 'a', command: 'node', enabled: false, label: '   ' } });
    expect(s?.enabled).toBe(false);
    expect(s).not.toHaveProperty('label');
  });
  it('requires a command for stdio', () => {
    expect(sanitizeMcpServer({ raw: { id: 'a', transport: 'stdio' } })).toBeNull();
    expect(sanitizeMcpServer({ raw: { id: 'a', transport: 'stdio', command: '   ' } })).toBeNull();
  });
  it('keeps sanitized args and env, dropping junk', () => {
    const raw = JSON.parse(
      '{"id":"a","command":"node","args":["--x","--y"],"env":{"A":"1","":"skip","B":123,"C":"","D":"  ","__proto__":"p","constructor":"c"}}',
    );
    const s = sanitizeMcpServer({ raw });
    expect(s?.args).toEqual(['--x', '--y']);
    expect(s?.env).toEqual({ A: '1' });
  });
  it('drops non-array args and all-junk env/args (undefined)', () => {
    const s = sanitizeMcpServer({ raw: { id: 'a', command: 'node', args: 'nope', env: { B: 123 } } });
    expect(s).not.toHaveProperty('args');
    expect(s).not.toHaveProperty('env');
    const s2 = sanitizeMcpServer({ raw: { id: 'a', command: 'node', args: [1, 2] } });
    expect(s2).not.toHaveProperty('args');
  });
  it('requires a valid http(s) url for remote transports', () => {
    expect(sanitizeMcpServer({ raw: { id: 'a', transport: 'http' } })).toBeNull();
    expect(sanitizeMcpServer({ raw: { id: 'a', transport: 'http', url: '   ' } })).toBeNull();
    expect(sanitizeMcpServer({ raw: { id: 'a', transport: 'http', url: 'not a url' } })).toBeNull();
    expect(sanitizeMcpServer({ raw: { id: 'a', transport: 'http', url: 'ftp://example.com' } })).toBeNull();
  });
  it('accepts a remote server, infers auth mode, and keeps headers', () => {
    const s = sanitizeMcpServer({ raw: {
      id: 'remote',
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer x' },
    } });
    expect(s?.transport).toBe('http');
    expect(s?.authMode).toBe('oauth');
    expect(s?.headers).toEqual({ Authorization: 'Bearer x' });
  });
  it('honors an explicit valid authMode and rejects an invalid one', () => {
    const none = sanitizeMcpServer({ raw: { id: 'r', transport: 'sse', url: 'https://x.example.com', authMode: 'none' } });
    expect(none?.authMode).toBe('none');
    const bogus = sanitizeMcpServer({ raw: { id: 'r', transport: 'sse', url: 'https://x.example.com', authMode: 'bogus' } });
    expect(bogus).toBeNull();
  });
});

describe('sanitizeMcpServer boundaries', () => {
  it('rejects a supplied non-string transport instead of defaulting to stdio', () => {
    expect(sanitizeMcpServer({ raw: { id: 'a', transport: 42, command: 'node' } })).toBeNull();
  });
  it('rejects an invalid authMode on a stdio server', () => {
    expect(sanitizeMcpServer({ raw: { id: 'a', command: 'node', authMode: 'bogus' } })).toBeNull();
  });
  it('validates but does not persist a valid authMode on a stdio server', () => {
    expect(sanitizeMcpServer({ raw: { id: 'a', command: 'node', authMode: 'none' } })).toEqual({ id: 'a', transport: 'stdio', enabled: true, command: 'node' });
  });
  it('trims the id and command', () => {
    expect(sanitizeMcpServer({ raw: { id: '  a  ', command: '  node  ' } })).toEqual({ id: 'a', transport: 'stdio', enabled: true, command: 'node' });
  });
  it('normalizes a remote url and infers none for loopback', () => {
    expect(sanitizeMcpServer({ raw: { id: 'r', transport: 'http', url: '  http://localhost:3000  ' } })).toEqual({ id: 'r', transport: 'http', enabled: true, url: 'http://localhost:3000/', authMode: 'none' });
  });
  it('drops stdio-only fields from a remote server and remote-only fields from a stdio server', () => {
    expect(sanitizeMcpServer({ raw: { id: 'r', transport: 'sse', url: 'https://x.example.com', command: 'node', args: ['x'], env: { A: '1' } } })).toEqual({ id: 'r', transport: 'sse', enabled: true, url: 'https://x.example.com/', authMode: 'oauth' });
    expect(sanitizeMcpServer({ raw: { id: 's', command: 'node', url: 'https://x.example.com', headers: { A: '1' } } })).toEqual({ id: 's', transport: 'stdio', enabled: true, command: 'node' });
  });
  it('treats a non-object env or headers as absent', () => {
    expect(sanitizeMcpServer({ raw: { id: 's', command: 'node', env: ['A'] } })).not.toHaveProperty('env');
    expect(sanitizeMcpServer({ raw: { id: 'r', transport: 'http', url: 'https://x.example.com', headers: 'A=1' } })).not.toHaveProperty('headers');
  });
});

describe('sanitizeMcpConfig', () => {
  it('returns empty for non-objects and non-array servers', () => {
    expect(sanitizeMcpConfig({ raw: 42 })).toEqual({ servers: [] });
    expect(sanitizeMcpConfig({ raw: { servers: 'nope' } })).toEqual({ servers: [] });
  });
  it('drops invalid entries and de-dupes by id (first wins)', () => {
    const cfg = sanitizeMcpConfig({ raw: {
      servers: [
        { id: 'a', command: 'node' },
        { id: 'bad' }, // no command
        { id: 'a', command: 'other' }, // dupe id dropped
        { id: 'b', command: 'deno' },
      ],
    } });
    expect(cfg.servers.map((s) => s.id)).toEqual(['a', 'b']);
    expect(cfg.servers[0]?.command).toBe('node');
  });
});

describe('readMcpConfig / writeMcpConfig', () => {
  it('returns empty when the config file does not exist', async () => {
    await expect(readMcpConfig({ dataDir: tmp() })).resolves.toEqual({ servers: [] });
  });
  it('returns empty and logs on corrupt JSON', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'mcp-config.json'), '{ not json');
    await expect(readMcpConfig({ dataDir: dir })).resolves.toEqual({ servers: [] });
  });
  it('rethrows non-ENOENT / non-syntax read errors (EISDIR)', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'mcp-config.json')); // reading a directory throws EISDIR
    await expect(readMcpConfig({ dataDir: dir })).rejects.toMatchObject({ code: 'EISDIR' });
  });
  it('sanitizes, persists, and round-trips through the mutex', async () => {
    const dir = tmp();
    const written = await writeMcpConfig({ dataDir: dir, body: { servers: [{ id: 'a', command: 'node' }, { id: 'bad' }] } });
    expect(written.servers.map((s) => s.id)).toEqual(['a']);
    await expect(readMcpConfig({ dataDir: dir })).resolves.toEqual(written);
  });
  it('serializes concurrent writes on the same dataDir', async () => {
    const dir = tmp();
    const [a, b] = await Promise.all([
      writeMcpConfig({ dataDir: dir, body: { servers: [{ id: 'a', command: 'node' }] } }),
      writeMcpConfig({ dataDir: dir, body: { servers: [{ id: 'b', command: 'deno' }] } }),
    ]);
    expect(a.servers[0]?.id).toBe('a');
    expect(b.servers[0]?.id).toBe('b');
    const final = await readMcpConfig({ dataDir: dir });
    expect(final.servers[0]?.id).toBe('b'); // last write wins
  });

  it('writes mcp-config.json with owner-only (0600) permissions (CR-006 / SEC-RB-002 — env/headers may carry API keys)', async () => {
    const dir = tmp();
    await writeMcpConfig({ dataDir: dir, body: { servers: [{ id: 'a', command: 'node' }] } });
    if (process.platform !== 'win32') {
      const mode = fs.statSync(path.join(dir, 'mcp-config.json')).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });
});

describe('isManagedProjectCwd', () => {
  it('accepts only real subdirectories of the projects root', () => {
    const projects = '/data/projects';
    expect(isManagedProjectCwd({ cwd: `${projects}/p1`, projectsDir: projects })).toBe(true);
    expect(isManagedProjectCwd({ cwd: projects, projectsDir: projects })).toBe(false);
    expect(isManagedProjectCwd({ cwd: '/somewhere/else', projectsDir: projects })).toBe(false);
    expect(isManagedProjectCwd({ cwd: null, projectsDir: projects })).toBe(false);
    expect(isManagedProjectCwd({ cwd: undefined, projectsDir: projects })).toBe(false);
    expect(isManagedProjectCwd({ cwd: '/data/projects/p', projectsDir: '' })).toBe(false);
  });

  it('rejects a lexical ".." escape even though the raw string starts with the projects-root prefix (CR-006 / SEC-RB-011)', () => {
    const projects = '/data/projects';
    expect(isManagedProjectCwd({ cwd: `${projects}/../escape`, projectsDir: projects })).toBe(false);
    expect(isManagedProjectCwd({ cwd: `${projects}/p1/../../escape`, projectsDir: projects })).toBe(false);
  });

  describe('realpath-based containment against a real filesystem', () => {
    const realDirs: string[] = [];
    function realTmp(): string {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jini-mcp-managed-cwd-'));
      realDirs.push(d);
      return d;
    }
    afterEach(() => {
      for (const d of realDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    });

    it('accepts a real subdirectory of the projects root after realpath resolution', () => {
      const root = realTmp();
      const projects = path.join(root, 'projects');
      fs.mkdirSync(projects);
      const proj = path.join(projects, 'p1');
      fs.mkdirSync(proj);
      expect(isManagedProjectCwd({ cwd: proj, projectsDir: projects })).toBe(true);
    });

    it('rejects a symlinked descendant that resolves outside the projects root', () => {
      const root = realTmp();
      const projects = path.join(root, 'projects');
      const outside = path.join(root, 'outside');
      fs.mkdirSync(projects);
      fs.mkdirSync(outside);
      const evilLink = path.join(projects, 'evil');
      fs.symlinkSync(outside, evilLink);
      expect(isManagedProjectCwd({ cwd: evilLink, projectsDir: projects })).toBe(false);
    });

    it('rejects a symlinked projects root whose real target differs from a symlinked cwd elsewhere', () => {
      const root = realTmp();
      const realProjects = path.join(root, 'real-projects');
      const outside = path.join(root, 'outside');
      fs.mkdirSync(realProjects);
      fs.mkdirSync(outside);
      const projectsLink = path.join(root, 'projects-link');
      fs.symlinkSync(realProjects, projectsLink);
      // A path that is lexically under the symlinked root name, but whose
      // real target is outside the real projects tree.
      const evilLink = path.join(realProjects, 'evil');
      fs.symlinkSync(outside, evilLink);
      expect(isManagedProjectCwd({ cwd: path.join(projectsLink, 'evil'), projectsDir: projectsLink })).toBe(false);
    });
  });
});

describe('buildClaudeMcpJson', () => {
  it('returns null when no servers are enabled', () => {
    expect(buildClaudeMcpJson({ servers: [{ id: 'a', transport: 'stdio', enabled: false, command: 'node' }] })).toBeNull();
  });
  it('builds stdio entries with and without args/env', () => {
    const servers: McpServerConfig[] = [
      { id: 'full', transport: 'stdio', enabled: true, command: 'node', args: ['x'], env: { A: '1' } },
      { id: 'bare', transport: 'stdio', enabled: true, command: 'deno' },
    ];
    expect(buildClaudeMcpJson({ servers })).toEqual({
      mcpServers: {
        full: { command: 'node', args: ['x'], env: { A: '1' } },
        bare: { command: 'deno' },
      },
    });
  });
  it('injects the oauth bearer, respects pinned auth, skips none-mode, and drops blank auth', () => {
    const servers: McpServerConfig[] = [
      { id: 'oauth', transport: 'http', enabled: true, url: 'https://a.example.com', authMode: 'oauth' },
      { id: 'pinned', transport: 'http', enabled: true, url: 'https://b.example.com', authMode: 'oauth', headers: { Authorization: 'Bearer pinned', 'X-Extra': 'v' } },
      { id: 'nomode', transport: 'http', enabled: true, url: 'https://c.example.com', authMode: 'none' },
      { id: 'blank', transport: 'sse', enabled: true, url: 'https://d.example.com', authMode: 'none', headers: { Authorization: '   ' } },
    ];
    const out = buildClaudeMcpJson({ servers }, { tokens: { oauth: 'TOK', pinned: 'IGNORED', nomode: 'NOPE' } }) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(out.mcpServers.oauth).toEqual({ type: 'http', url: 'https://a.example.com', headers: { Authorization: 'Bearer TOK' } });
    expect(out.mcpServers.pinned?.headers).toEqual({ Authorization: 'Bearer pinned', 'X-Extra': 'v' });
    expect(out.mcpServers.nomode).toEqual({ type: 'http', url: 'https://c.example.com' });
    expect(out.mcpServers.blank).toEqual({ type: 'sse', url: 'https://d.example.com' });
  });
  it('infers oauth for a remote server with no explicit authMode', () => {
    const out = buildClaudeMcpJson({ servers: [{ id: 's', transport: 'http', enabled: true, url: 'https://remote.example.com' }] }, { tokens: { s: 'TT' } }
    ) as { mcpServers: Record<string, Record<string, unknown>> };
    expect(out.mcpServers.s?.headers).toEqual({ Authorization: 'Bearer TT' });
  });
});

describe('buildClaudeMcpJson boundaries', () => {
  it('omits empty args/env on stdio and empty headers on remote', () => {
    const servers: McpServerConfig[] = [
      { id: 's', transport: 'stdio', enabled: true, command: 'node', args: [], env: {} },
      { id: 'r', transport: 'http', enabled: true, url: 'https://x.example.com', authMode: 'oauth', headers: {} },
    ];
    expect(buildClaudeMcpJson({ servers })).toEqual({ mcpServers: { s: { command: 'node' }, r: { type: 'http', url: 'https://x.example.com' } } });
  });
  it('keeps disabled servers out of a non-empty result', () => {
    const servers: McpServerConfig[] = [
      { id: 'on', transport: 'stdio', enabled: true, command: 'node' },
      { id: 'off', transport: 'stdio', enabled: false, command: 'deno' },
    ];
    expect(buildClaudeMcpJson({ servers })).toEqual({ mcpServers: { on: { command: 'node' } } });
  });
  it('treats a lower-case pinned authorization header as user-pinned', () => {
    const servers: McpServerConfig[] = [{ id: 'r', transport: 'http', enabled: true, url: 'https://x.example.com', authMode: 'oauth', headers: { authorization: 'Bearer mine' } }];
    expect(buildClaudeMcpJson({ servers }, { tokens: { r: 'TOK' } })).toEqual({ mcpServers: { r: { type: 'http', url: 'https://x.example.com', headers: { authorization: 'Bearer mine' } } } });
  });
  it('replaces a blank authorization header with the oauth bearer', () => {
    const servers: McpServerConfig[] = [{ id: 'r', transport: 'http', enabled: true, url: 'https://x.example.com', authMode: 'oauth', headers: { Authorization: '  ', X: 'v' } }];
    expect(buildClaudeMcpJson({ servers }, { tokens: { r: 'TOK' } })).toEqual({ mcpServers: { r: { type: 'http', url: 'https://x.example.com', headers: { X: 'v', Authorization: 'Bearer TOK' } } } });
  });
});

describe('buildAcpMcpServers', () => {
  it('returns an empty array when no enabled stdio servers exist', () => {
    expect(buildAcpMcpServers({ servers: [{ id: 'r', transport: 'sse', enabled: true, url: 'https://x.example.com' }] })).toEqual([]);
  });
  it('copies args rather than sharing the config array', () => {
    const args = ['x'];
    const [entry] = buildAcpMcpServers({ servers: [{ id: 'a', transport: 'stdio', enabled: true, command: 'node', args }] });
    expect(entry?.args).toEqual(['x']);
    expect(entry?.args).not.toBe(args);
  });

  it('keeps only enabled stdio servers and flattens env, skipping non-string values', () => {
    const servers: McpServerConfig[] = [
      { id: 'a', transport: 'stdio', enabled: true, command: 'node', args: ['x'], env: { good: 'v', bad: 1 as unknown as string } },
      { id: 'noargs', transport: 'stdio', enabled: true },
      { id: 'remote', transport: 'http', enabled: true, url: 'https://x.example.com' },
      { id: 'off', transport: 'stdio', enabled: false, command: 'nope' },
    ];
    const out = buildAcpMcpServers({ servers });
    expect(out).toEqual([
      { type: 'stdio', name: 'a', command: 'node', args: ['x'], env: [{ name: 'good', value: 'v' }] },
      { type: 'stdio', name: 'noargs', command: '', args: [], env: [] },
    ]);
  });
});

describe('buildOpenCodeMcpConfigContent', () => {
  it('returns null when nothing would be emitted', () => {
    expect(buildOpenCodeMcpConfigContent({ servers: [] })).toBeNull();
    // stdio without a command and remote without a url are both skipped
    expect(
      buildOpenCodeMcpConfigContent({ servers: [
        { id: 'a', transport: 'stdio', enabled: true },
        { id: 'b', transport: 'http', enabled: true },
      ] }),
    ).toBeNull();
  });
  it('emits local + remote entries with env and merged auth headers, and no headers for a none-auth remote', () => {
    const servers: McpServerConfig[] = [
      { id: 'loc', transport: 'stdio', enabled: true, command: 'node', args: ['x'], env: { A: '1' } },
      { id: 'rem', transport: 'http', enabled: true, url: 'https://r.example.com', authMode: 'oauth' },
      { id: 'rembare', transport: 'http', enabled: true, url: 'https://n.example.com', authMode: 'none' },
    ];
    const cfg = JSON.parse(buildOpenCodeMcpConfigContent({ servers }, { tokens: { rem: 'TOK' } }) as string);
    expect(cfg.mcp.loc).toEqual({ type: 'local', command: ['node', 'x'], environment: { A: '1' }, enabled: true });
    expect(cfg.mcp.rem).toEqual({ type: 'remote', url: 'https://r.example.com', headers: { Authorization: 'Bearer TOK' }, enabled: true });
    expect(cfg.mcp.rembare).toEqual({ type: 'remote', url: 'https://n.example.com', enabled: true });
  });
  it('trims the stdio command but emits the remote url verbatim', () => {
    const cfg = JSON.parse(buildOpenCodeMcpConfigContent({ servers: [
      { id: 'loc', transport: 'stdio', enabled: true, command: '  node  ' },
      { id: 'rem', transport: 'http', enabled: true, url: ' https://r.example.com ', authMode: 'none' },
    ] }) as string);
    expect(cfg.mcp.loc.command).toEqual(['node']);
    expect(cfg.mcp.rem.url).toBe(' https://r.example.com ');
  });
  it('skips disabled servers and a whitespace-only command or url', () => {
    expect(buildOpenCodeMcpConfigContent({ servers: [
      { id: 'off', transport: 'stdio', enabled: false, command: 'node' },
      { id: 'blankcmd', transport: 'stdio', enabled: true, command: '   ' },
      { id: 'blankurl', transport: 'sse', enabled: true, url: '   ' },
    ] })).toBeNull();
  });
  it('drops the oauth bearer for a none-auth remote and an empty env object', () => {
    const cfg = JSON.parse(buildOpenCodeMcpConfigContent({ servers: [
      { id: 'loc', transport: 'stdio', enabled: true, command: 'node', env: {} },
      { id: 'rem', transport: 'http', enabled: true, url: 'http://localhost:1', headers: {} },
    ] }, { tokens: { rem: 'TOK' } }) as string);
    expect(cfg).toEqual({ mcp: {
      loc: { type: 'local', command: ['node'], enabled: true },
      rem: { type: 'remote', url: 'http://localhost:1', enabled: true },
    } });
  });
  it('replaces an array prior permission and keeps mcp alongside extraConfig', () => {
    const cfg = JSON.parse(buildOpenCodeMcpConfigContent({ servers: [{ id: 'loc', transport: 'stdio', enabled: true, command: 'node' }] }, {
      allowedDirectories: ['/'], extraConfig: { permission: ['x'], provider: 'p' }, resolvePath: ({ filePath }) => filePath,
    }) as string);
    expect(cfg).toEqual({
      provider: 'p',
      mcp: { loc: { type: 'local', command: ['node'], enabled: true } },
      permission: { external_directory: { '/': 'allow', '/*': 'allow', '/**': 'allow' } },
    });
  });
  it('normalizes a trailing separator and de-duplicates directory variants', () => {
    const cfg = JSON.parse(buildOpenCodeMcpConfigContent({ servers: [] }, {
      allowedDirectories: ['/a/b/', '/a/b'], resolvePath: ({ filePath }) => filePath,
    }) as string);
    expect(cfg).toEqual({ permission: { external_directory: { '/a/b': 'allow', '/a/b/*': 'allow', '/a/b/**': 'allow' } } });
  });
  it('emits a stdio entry without environment when env is empty', () => {
    const cfg = JSON.parse(
      buildOpenCodeMcpConfigContent({ servers: [{ id: 'loc', transport: 'stdio', enabled: true, command: 'node' }] }) as string,
    );
    expect(cfg.mcp.loc).toEqual({ type: 'local', command: ['node'], enabled: true });
  });
  it('builds an external_directory allowlist, honoring symlink real paths, root, and merging prior permission', () => {
    const realTarget = tmp();
    const linkParent = tmp();
    const linkPath = path.join(linkParent, 'link');
    fs.symlinkSync(realTarget, linkPath);
    const resolvedTarget = fs.realpathSync.native(linkPath); // link + /var->/private/var both resolved
    const cfg = JSON.parse(
      buildOpenCodeMcpConfigContent({ servers: [] }, { tokens: {},
        allowedDirectories: [
          linkPath, // realpath differs from the given path
          '/', // filesystem root -> normalizeAllowedDirectory returns root, glob joins without a doubled sep
          'relative/not/absolute', // dropped (not absolute)
          '   ', // dropped (blank)
          '/does/not/exist/xyz123', // realpath throws -> keeps the normalized path only
        ],
        extraConfig: { permission: { some_prior: 'allow' } },
      }) as string,
    );
    const allow = cfg.permission.external_directory as Record<string, string>;
    expect(cfg.permission.some_prior).toBe('allow'); // prior permission preserved
    expect(allow['/']).toBe('allow');
    expect(allow['/*']).toBe('allow'); // root joins to "/*", not "//*"
    expect(allow[linkPath]).toBe('allow'); // the given (unresolved) path
    expect(allow[resolvedTarget]).toBe('allow'); // and its resolved real target
    expect(allow['/does/not/exist/xyz123']).toBe('allow');
  });
  it('emits only extraConfig when there are no servers or directories', () => {
    const cfg = JSON.parse(
      buildOpenCodeMcpConfigContent({ servers: [] }, { tokens: {}, extraConfig: { provider: { openai: {} } } }) as string,
    );
    expect(cfg).toEqual({ provider: { openai: {} } });
  });
  it('discards a non-object prior permission when attaching the external_directory allowlist', () => {
    const cfg = JSON.parse(
      buildOpenCodeMcpConfigContent({ servers: [] }, { tokens: {},
        allowedDirectories: ['/'],
        extraConfig: { permission: 'not-an-object' },
      }) as string,
    );
    expect(typeof cfg.permission).toBe('object');
    expect(cfg.permission.external_directory['/']).toBe('allow');
  });
});

// REGRESSION: fails if inferMcpAuthModeForUrl restores the old trim-all-trailing-dots helper.
it('requires authentication for malformed multi-dot localhost and mapped IPv6 loopback', () => {
  expect(inferMcpAuthModeForUrl({ rawUrl: 'http://localhost..:3000' })).toBe('oauth');
  expect(inferMcpAuthModeForUrl({ rawUrl: 'http://[::ffff:7f00:1]:3000' })).toBe('oauth');
  expect(inferMcpAuthModeForUrl({ rawUrl: 'http://localhost.:3000' })).toBe('none');
});

// REGRESSION: fails if isManagedProjectCwd returns to platform's !relative.startsWith('..') check.
it('accepts a legal dot-prefixed project while rejecting a sibling prefix', () => {
  const projectsDir = path.resolve('/projects');
  const resolvePath = ({ filePath }: { filePath: string }) => path.resolve(filePath);
  expect(isManagedProjectCwd({ projectsDir, cwd: path.join(projectsDir, '..legal-name') }, { resolvePath })).toBe(true);
  expect(isManagedProjectCwd({ projectsDir, cwd: projectsDir + '-sibling/site' }, { resolvePath })).toBe(false);
});

// Stryker L3 re-score (F3): each input guard of isManagedProjectCwd survived alone (they were only
// ever reached with a valid projectsDir), and the transport/auth discriminators with wrong types.
describe('isManagedProjectCwd — one guard per case (F3)', () => {
  const identity = { resolvePath: ({ filePath }: { filePath: string }) => path.resolve(filePath) };
  it.each([
    ['empty cwd', '', '/data/projects', false],
    ['null cwd', null, '/data/projects', false],
    ['non-string cwd', 7, '/data/projects', false],
    ['empty projectsDir', '/data/projects/p', '', false],
    ['non-string projectsDir', '/data/projects/p', 7, false],
    ['the root itself', '/data/projects', '/data/projects', false],
    ['the root with a trailing slash', '/data/projects/', '/data/projects', false],
    ['a sibling sharing the prefix', '/data/projects-other/p', '/data/projects', false],
    ['a direct child', '/data/projects/p', '/data/projects', true],
    ['a nested child', '/data/projects/p/q', '/data/projects', true],
  ])('%s → %s', (_label, cwd, projectsDir, expected) => {
    expect(isManagedProjectCwd({ cwd: cwd as string, projectsDir: projectsDir as string }, identity)).toBe(expected);
  });
});

describe('sanitizeMcpServer transport/auth discriminators (F3)', () => {
  it.each([['HTTP'], [''], [5], [null], ['websocket']])('refuses transport %j instead of defaulting', (transport) => {
    expect(sanitizeMcpServer({ raw: { id: 'a', transport, command: 'node', url: 'https://x.test' } })).toBeNull();
  });
  it('an absent transport is stdio', () => {
    expect(sanitizeMcpServer({ raw: { id: 'a', command: 'node' } })?.transport).toBe('stdio');
  });
});
