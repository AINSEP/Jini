import path from 'node:path';
import type { ExecutableResolutionHelpers, ResolvedExecutableOptions } from '../../executable-helpers.js';

// The official OpenAI Codex desktop app ships the `codex` CLI *inside* its
// macOS application bundle and does NOT add it to PATH unless the user
// explicitly runs the app's "Install command line tool" action. Users who
// installed Codex only through the app therefore see a "not installed"
// agent card even though a healthy native `codex` binary exists on disk,
// because neither PATH nor the user-toolchain search dirs cover the app
// bundle. Probe the well-known bundle locations so app-only installs are
// detected. This is a last-resort fallback that ranks below PATH, so an
// explicit `npm i -g` / Homebrew / version-manager install always wins.
export function codexAppBundleExecutable(options: ResolvedExecutableOptions, services: ExecutableResolutionHelpers): string | null {
  for (const candidate of codexBundleCandidates(options, services)) {
    const resolved = services.executableFilePath(candidate, options);
    if (resolved) return resolved;
  }
  return null;
}

export function codexBundleCandidates(options: ResolvedExecutableOptions, services: ExecutableResolutionHelpers): string[] {
  // The Codex app bundle is a macOS-only concept; other platforms have no
  // analogous standalone install of the `codex` CLI to probe for here.
  if (process.platform !== 'darwin') return [];
  const { home, hasOverride } = services.resolveDetectionHome(options);
  const bundleSuffix = ['Codex.app', 'Contents', 'Resources', 'codex'];
  // User-scoped install (~/Applications). Honors the override home so
  // sandboxed detection runs and tests stay deterministic.
  const candidates = [path.join(home, 'Applications', ...bundleSuffix)];
  // System-wide /Applications install. Skip it under an override home for
  // the same isolation reason `userToolchainDirs` skips Homebrew/system
  // bins.
  if (!hasOverride) {
    candidates.unshift(path.join('/Applications', ...bundleSuffix));
  }
  return candidates;
}

