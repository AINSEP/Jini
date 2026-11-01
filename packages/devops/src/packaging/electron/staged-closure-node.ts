import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { RuntimeResolverPort } from './ports.js';
/** Native Node resolution preserves conditional exports, package imports and nested versions.
 * The explicit flag enables Node's parent URL parameter; omitting it would resolve from this tool.
 * No imported module is evaluated. The caller checks target containment and existence.
 */
export function createNodeRuntimeResolver(_input: Record<string, never>, _options: Record<string, never> = {}): RuntimeResolverPort {
  if (!process.execArgv.includes('--experimental-import-meta-resolve')) throw new Error('staged closure needs node --experimental-import-meta-resolve to resolve from each staged importer');
  return { resolve({ fromFile, specifier, kind }) {
    if (kind === 'require') return createRequire(fromFile).resolve(specifier);
    const resolve = import.meta.resolve as (specifier: string, parent: string) => string;
    return fileURLToPath(resolve(specifier, pathToFileURL(fromFile).href));
  } };
}
