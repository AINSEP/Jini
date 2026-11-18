import { realpathSync } from 'node:fs';
import path from 'node:path';
import { trimCharsEnd } from '@jini-ai/core/text';
import type { McpServerConfig } from '../config.js';
import { isPlainObject, nonEmptyField, remoteHeadersField } from '../config-shared.js';

/**
 * OpenCode merges its config from multiple sources at boot — global
 * `~/.config/opencode/opencode.json`, the `OPENCODE_CONFIG` file path, the
 * project `opencode.json`, and the `OPENCODE_CONFIG_CONTENT` env var (an
 * inline JSON string). The env-var path is what lets a launcher hand servers
 * to a single `opencode run` invocation without writing into the user's
 * global config or leaving a temp file around on crash. We also use the same
 * payload to grant `external_directory` access to launcher-selected absolute
 * paths (project cwd, staged skill dirs, etc.) so headless OpenCode runs do
 * not auto-reject them.
 *
 * Returns `null` when nothing would be emitted — the caller must NOT set
 * `OPENCODE_CONFIG_CONTENT` to `null`/empty in that case, because doing so
 * would override the user's saved global config with an empty object. A
 * null return means "leave the env untouched and let OpenCode read the
 * user's home-dir config as-is."
 *
 * The OAuth Bearer merge mirrors `buildClaudeMcpJson` so a remote MCP
 * server the daemon already authenticated against works the same way for
 * OpenCode users without forcing them to re-authenticate inside OpenCode.
 */
/** Options for `buildOpenCodeMcpConfigContent`. */
export interface OpenCodeConfigBuildOptions {
  /** Access tokens keyed by server id. */
  tokens?: Record<string, string>;
  /** Resolves symlinks for permission allowlists. */
  resolvePath?: (args: { filePath: string }) => string;
  /** Absolute filesystem paths OpenCode's `external_directory` permission should allow. */
  allowedDirectories?: string[];
  /** Additional top-level keys merged into the emitted config object (e.g. `provider`). */
  extraConfig?: Record<string, unknown>;
}

export function buildOpenCodeMcpConfigContent(
  { servers }: { servers: McpServerConfig[] },
  options: OpenCodeConfigBuildOptions = {},
): string | null {
  const tokens = options.tokens ?? {};
  const resolvePath = options.resolvePath ?? (({ filePath }: { filePath: string }) => realpathSync.native(filePath));
  const mcp: Record<string, Record<string, unknown>> = {};
  for (const s of servers.filter((server) => server.enabled)) {
    const entry = buildOpenCodeServerEntry({ server: s, tokens });
    if (entry) mcp[s.id] = entry;
  }
  const externalDirectory = buildOpenCodeExternalDirectoryAllowlist(
    options.allowedDirectories, resolvePath,
  );
  const config: Record<string, unknown> = { ...options.extraConfig, ...nonEmptyField({ key: 'mcp', value: mcp }) };
  if (externalDirectory) {
    const permission = { v: config.permission };
    const priorPermission = isPlainObject(permission) ? permission.v : {};
    config.permission = {
      ...priorPermission,
      external_directory: externalDirectory,
    };
  }
  return Object.keys(config).length === 0 ? null : JSON.stringify(config);
}

/** One OpenCode `mcp` entry, or null when the server lacks its transport-required command/url. */
function buildOpenCodeServerEntry(
  { server: s, tokens }: { server: McpServerConfig; tokens: Record<string, string> },
): Record<string, unknown> | null {
  if (s.transport === 'stdio') {
    const cmd = typeof s.command === 'string' ? s.command.trim() : '';
    if (!cmd) return null;
    return {
      type: 'local',
      command: [cmd, ...(Array.isArray(s.args) ? s.args : [])],
      ...nonEmptyField({ key: 'environment', value: { ...s.env } }),
      enabled: true,
    };
  }
  if (typeof s.url !== 'string' || !s.url.trim()) return null;
  return { type: 'remote', url: s.url, ...remoteHeadersField({ server: s, tokens }), enabled: true };
}

function buildOpenCodeExternalDirectoryAllowlist(
  directories: string[] | undefined,
  resolvePath: (args: { filePath: string }) => string,
): Record<string, 'allow'> | null {
  const normalized = Array.from(
    new Set(
      (directories ?? [])
        .filter((dir) => typeof dir === 'string' && dir.trim().length > 0)
        .filter((dir) => path.isAbsolute(dir))
        .flatMap((dir) => normalizeAllowedDirectoryVariants(dir, resolvePath)),
    ),
  );
  if (normalized.length === 0) return null;

  const allowlist: Record<string, 'allow'> = {};
  for (const dir of normalized) {
    allowlist[dir] = 'allow';
    allowlist[joinPermissionGlob(dir, '*')] = 'allow';
    allowlist[joinPermissionGlob(dir, '**')] = 'allow';
  }
  return allowlist;
}

function normalizeAllowedDirectory(dir: string): string {
  const resolved = path.resolve(dir);
  const root = path.parse(resolved).root;
  if (resolved === root) return root;
  return trimCharsEnd({ text: resolved, chars: '\\/' });
}

function normalizeAllowedDirectoryVariants(dir: string, resolvePath: (args: { filePath: string }) => string): string[] {
  const normalized = normalizeAllowedDirectory(dir);
  let real: string | null = null;
  try {
    real = normalizeAllowedDirectory(resolvePath({ filePath: dir }));
  } catch {
    real = null;
  }
  return real && real !== normalized ? [normalized, real] : [normalized];
}

function joinPermissionGlob(dir: string, suffix: '*' | '**'): string {
  return dir.endsWith(path.sep) ? `${dir}${suffix}` : `${dir}${path.sep}${suffix}`;
}
