/**
 * @module resource-paths
 *
 * Resolves the paths a packaged desktop host needs to find itself: its own
 * CLI entry point, a packaged-app "resources" directory (macOS `.app`
 * bundle / Windows install-relative layout), a resource root override
 * (validated to stay under safe bases), plugin-preview scratch space, and
 * the daemon's on-disk data directory.
 *
 * Generalized from an upstream flat daemon module: every hardcoded env-var
 * name, the host CLI's own package specifier, the default data-directory
 * name, and the Windows packaged-resources marker segment are now fields on
 * {@link ResourcePathsConfig} — see `archived provenance ledger` for the exact mapping.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { resolveProjectRelativePath } from './home-expansion.js';

const require = createRequire(import.meta.url);

/** Names the env vars and product identifiers this port reads/writes. */
export interface ResourcePathsConfig {
  /** Primary env var carrying an explicit CLI entry-point path override. */
  cliPathEnvVar: string;
  /** Secondary/legacy env var carrying the same override. */
  cliPathFallbackEnvVar: string;
  /** The npm package specifier whose `package.json` locates the CLI when no override is set. */
  cliPackageName: string;
  /** Env var carrying an explicit resource-root override. */
  resourceRootEnvVar: string;
  /** Env var carrying an explicit plugin-previews-directory override. */
  pluginPreviewsDirEnvVar: string;
  /** Env var carrying the daemon's data directory. */
  dataDirEnvVar: string;
  /** Directory name used under `projectRoot` when {@link dataDirEnvVar} is unset. */
  defaultDataDirName: string;
  /** Path segment identifying a Windows packaged-app `resources/<segment>/bin/` layout. */
  windowsResourceBinSegment: string;
}

function cleanOptionalPath(value: string | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? path.resolve(value) : null;
}

/**
 * Resolves the daemon CLI's own entry-point path: an explicit env override
 * first, then the CLI's own package location.
 */
export function resolveDaemonCliPath(
  config: ResourcePathsConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured =
    cleanOptionalPath(env[config.cliPathEnvVar]) ?? cleanOptionalPath(env[config.cliPathFallbackEnvVar]);
  if (configured) return configured;

  const packageJsonPath = require.resolve(`${config.cliPackageName}/package.json`);
  return path.join(path.dirname(packageJsonPath), 'dist', 'cli.js');
}

function isPathWithin(base: string, target: string): boolean {
  const relativePath = path.relative(path.resolve(base), path.resolve(target));
  return (
    relativePath === '' ||
    (relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

/**
 * Resolves a packaged-app "resources" directory: Electron's own
 * `process.resourcesPath` when present, else a macOS `.app/Contents/Resources`
 * marker in `process.execPath`, else a Windows `resources/<segment>/bin`
 * marker. Returns `null` when running unpackaged (plain Node).
 */
export function resolveProcessResourcesPath(
  config: ResourcePathsConfig,
  processInfo: { resourcesPath?: string; execPath: string } = process,
): string | null {
  const { resourcesPath } = processInfo;
  if (typeof resourcesPath === 'string' && resourcesPath.length > 0) {
    return resourcesPath;
  }

  const resourcesMarker = `${path.sep}Contents${path.sep}Resources${path.sep}`;
  const markerIndex = processInfo.execPath.indexOf(resourcesMarker);
  if (markerIndex !== -1) {
    return processInfo.execPath.slice(0, markerIndex + resourcesMarker.length - 1);
  }

  const normalizedExecPath = processInfo.execPath.toLowerCase();
  const windowsResourceBinMarker =
    `${path.sep}resources${path.sep}${config.windowsResourceBinSegment}${path.sep}bin${path.sep}`.toLowerCase();
  const windowsMarkerIndex = normalizedExecPath.indexOf(windowsResourceBinMarker);
  if (windowsMarkerIndex !== -1) {
    return processInfo.execPath.slice(0, windowsMarkerIndex + `${path.sep}resources`.length);
  }

  return null;
}

export interface ResolveDaemonResourceRootOptions {
  configured?: string;
  safeBases?: Array<string | null | undefined>;
}

/**
 * Resolves an explicit resource-root override, requiring it to fall under
 * one of `safeBases`. Returns `null` when no override is configured; throws
 * when an override is configured but escapes every safe base.
 */
export function resolveDaemonResourceRoot(
  config: ResourcePathsConfig,
  { configured = process.env[config.resourceRootEnvVar], safeBases }: ResolveDaemonResourceRootOptions = {},
): string | null {
  if (!configured || configured.length === 0) return null;

  const resolved = path.resolve(configured);
  const normalizedSafeBases = (safeBases ?? [])
    .filter((base): base is string => typeof base === 'string' && base.length > 0)
    .map((base) => path.resolve(base));

  if (!normalizedSafeBases.some((base) => isPathWithin(base, resolved))) {
    throw new Error(`${config.resourceRootEnvVar} must be under the workspace root or app resources path`);
  }

  return resolved;
}

/** Joins `segment` under `resourceRoot` when present, else returns `fallback`. */
export function resolveDaemonResourceDir(resourceRoot: string | null, segment: string, fallback: string): string {
  return resourceRoot ? path.join(resourceRoot, segment) : fallback;
}

export interface ResolveDaemonPluginPreviewsDirOptions {
  env?: NodeJS.ProcessEnv;
  resourceRoot: string | null | undefined;
  projectRoot: string;
}

/**
 * Resolves the plugin-previews scratch directory: an explicit env override
 * (resolved against `projectRoot` if relative), else the standard
 * `data/plugin-previews` location under the resource root or project root.
 */
export function resolveDaemonPluginPreviewsDir(
  config: ResourcePathsConfig,
  { env = process.env, resourceRoot, projectRoot }: ResolveDaemonPluginPreviewsDirOptions,
): string {
  const override = env[config.pluginPreviewsDirEnvVar];
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(projectRoot, override);
  }
  return resolveDaemonResourceDir(
    resourceRoot ?? null,
    path.join('data', 'plugin-previews'),
    path.join(projectRoot, 'data', 'plugin-previews'),
  );
}

export interface ResolveDataDirOptions {
  requireExplicit?: boolean;
}

/**
 * Resolves the daemon's data directory: an explicit env value (expanded and
 * made absolute) if set, else `<projectRoot>/<defaultDataDirName>`. Creates
 * the resolved directory and verifies it's writable, throwing a
 * diagnostic-rich error otherwise.
 */
export function resolveDataDir(
  config: ResourcePathsConfig,
  raw: string | undefined,
  projectRoot: string,
  options: ResolveDataDirOptions = {},
): string {
  const value = raw?.trim();
  if (!value) {
    if (options.requireExplicit) {
      throw new Error(`${config.dataDirEnvVar} is required when sandboxing is enabled`);
    }
    return path.join(projectRoot, config.defaultDataDirName);
  }

  const resolved = resolveProjectRelativePath(value, projectRoot);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    fs.accessSync(resolved, fs.constants.W_OK);
  } catch (err) {
    const e = err as Error;
    const currentUser = (() => {
      try {
        return os.userInfo().username;
      } catch {
        return process.env.USER ?? process.env.LOGNAME ?? 'unknown';
      }
    })();
    const parentDir = path.dirname(resolved);
    throw new Error(
      [
        `${config.dataDirEnvVar} "${resolved}" is not writable: ${e.message}`,
        `Current user: ${currentUser}`,
        'Check whether the folder or one of its parents is owned by another user, is a symlink to a protected location, or was previously created with sudo.',
        `Try: ls -ld "${parentDir}" "${resolved}"`,
        `If the folder should belong to you, fix ownership/permissions, for example: sudo chown -R "${currentUser}":staff "${parentDir}" && chmod -R u+rwX "${parentDir}"`,
      ].join(' '),
    );
  }
  return resolved;
}
