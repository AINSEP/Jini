import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

interface RuntimeInput { searchFrom: readonly string[]; nodePath: string }
interface RuntimeOptions {
  resolveBinary?: (input: { directory: string }) => string;
  usable?: (input: { command: string; env: NodeJS.ProcessEnv }) => boolean;
  env?: NodeJS.ProcessEnv;
}

function installedBinary({ directory }: { directory: string }): string {
  const require = createRequire(path.join(directory, 'package.json'));
  const binary: unknown = require('electron');
  if (typeof binary !== 'string') throw new Error('Desktop runtime binary missing');
  return binary;
}

/** Probe without opening a window; a fused-off or incomplete installation is not usable as Node. */
function usableBinary({ command, env }: { command: string; env: NodeJS.ProcessEnv }): boolean {
  const result = spawnSync(command, ['-e', 'process.exit(process.versions.node ? 0 : 1)'], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore', timeout: 5000, windowsHide: true,
  });
  return result.status === 0;
}

/** Select an installed desktop Node runtime, falling back without refusing boot.
 * Executables are returned separately from arguments: paths with spaces work on Windows too.
 * @returns Command and the minimal environment override; never mutates the caller's environment.
 * @complexity O(search roots), with one bounded 5s native probe per discovered binary.
 */
export function selectNodeRuntime({ searchFrom, nodePath }: RuntimeInput,
  { resolveBinary = installedBinary, usable = usableBinary, env = process.env }: RuntimeOptions = {},
): { command: string; env: Record<string, string>; fallback: boolean } {
  for (const directory of searchFrom) {
    try {
      const command = resolveBinary({ directory });
      if (usable({ command, env })) return { command, env: { ELECTRON_RUN_AS_NODE: '1' }, fallback: false };
    } catch { /* An optional installation must never refuse local development. */ }
  }
  return { command: nodePath, env: {}, fallback: true };
}
