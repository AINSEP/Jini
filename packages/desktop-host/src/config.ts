/**
 * Generalized from OD `apps/packaged/src/config.ts`. That file was almost
 * entirely OD product config — telemetry relay URLs, PostHog keys, AMR
 * profile, daemon/web sidecar entry paths, web output mode — none of which
 * is a shell primitive; it stays OD-side. The one genuinely generic
 * mechanism buried in it is the *loading* pattern: an explicit-path env
 * var override (throws if set but the file is missing) falling back
 * through an ordered list of candidate paths, returning `{}` if none
 * exist. This file keeps only that, as a small generic JSON-config loader
 * with no baked-in fields.
 */
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  if (!(await pathExists(filePath))) return null;
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

export interface LoadHostConfigFileOptions {
  explicitPathEnvVar?: string;
  candidatePaths: string[];
  env?: NodeJS.ProcessEnv;
}

export async function loadHostConfigFile<T extends Record<string, unknown>>(requiredArgs: Pick<LoadHostConfigFileOptions, 'candidatePaths'>, optionalArgs: Omit<LoadHostConfigFileOptions, 'candidatePaths'> = {}
): Promise<T> {
  const options = { ...optionalArgs, ...requiredArgs };
  const env = options.env ?? process.env;
  const explicit = options.explicitPathEnvVar == null ? undefined : env[options.explicitPathEnvVar];
  if (explicit != null && explicit.length > 0) {
    const config = await readJsonIfExists<T>(resolve(explicit));
    if (config == null) throw new Error(`host config not found at ${explicit}`);
    return config;
  }
  for (const candidate of options.candidatePaths) {
    const config = await readJsonIfExists<T>(candidate);
    if (config != null) return config;
  }
  return {} as T;
}
