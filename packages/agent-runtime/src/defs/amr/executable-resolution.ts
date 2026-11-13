import path from 'node:path';
import { statSync } from 'node:fs';
import type { ExecutableResolutionHelpers, ResolvedExecutableOptions } from '../../executable-helpers.js';

export function resolveAmrCompanion(options: ResolvedExecutableOptions, services: ExecutableResolutionHelpers): string | null {
  const { env } = options;
  // In packaged builds prefer the bundled companion under
  // `<resourceRoot>/bin/libexec/opencode/opencode` so a stale global
  // `opencode` on the user's PATH can't override the known-good build that
  // shipped with this app. PATH is only consulted as a last resort.
  return services.executableFilePath(env.VELA_OPENCODE_BIN, options)
    ?? bundledAmrOpenCode({ resourceRoot: services.resourceRootOf(options) }, options, services)
    ?? services.searchPath({ bin: 'opencode-cli' }, options)
    ?? services.searchPath({ bin: 'opencode' }, options);
}

function bundledAmrOpenCode({ resourceRoot }: { resourceRoot: string | undefined }, options: ResolvedExecutableOptions, services: ExecutableResolutionHelpers): string | null {
  if (!resourceRoot) return null;
  const bundledDir = packagedVelaOpenCodeCompanionTree(resourceRoot, options, services);
  if (!bundledDir) return null;
  return services.executableFilePath(path.join(bundledDir, services.platformExecutableName({ name: 'opencode' })), options);
}

// The AMR (vela) OpenCode companion ships as a
// `<resourceRoot>/bin/libexec/opencode/opencode` *executable file*, not just
// the directory. Treating any directory there as a valid companion produces
// a false-positive availability path: `detectAgents()` would surface AMR as
// available even though the first real run can't launch. Verify the inner
// executable too.
function packagedVelaOpenCodeCompanionTree(resourceRoot: string, options: ResolvedExecutableOptions, services: ExecutableResolutionHelpers): string | null {
  const candidate = path.join(resourceRoot, 'bin', 'libexec', 'opencode');
  try {
    if (!statSync(candidate).isDirectory()) return null;
  } catch {
    return null;
  }
  return services.isRunnableFile(path.join(candidate, services.platformExecutableName({ name: 'opencode' })), options) ? candidate : null;
}

export function packagedAmrExecutable(
  configuredEnv: Record<string, string>,
  options: ResolvedExecutableOptions,
  services: ExecutableResolutionHelpers,
): string | null {
  const resourceRoot = services.resourceRootOf(options);
  if (!resourceRoot) return null;
  if (
    !resolveAmrCompanion({ ...options, env: { ...options.env, ...configuredEnv } }, services) &&
    !packagedVelaOpenCodeCompanionTree(resourceRoot, options, services)
  ) {
    return null;
  }
  const candidate = path.join(resourceRoot, 'bin', services.platformExecutableName({ name: 'vela' }));
  return services.isRunnableFile(candidate, options) ? candidate : null;
}

