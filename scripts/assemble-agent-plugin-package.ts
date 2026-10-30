/** Build-time asset assembly only; installed packages use the existing Agent Plugin lifecycle. */
import * as filesystem from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type AssemblyFilesystem = Pick<typeof filesystem, 'cp' | 'lstat' | 'mkdir' | 'mkdtemp' | 'readFile' | 'rename' | 'rm'>;
const assets = ['plugin.json', 'mcp.json', 'skills', 'com.anthropic.claude-code'] as const;
const excludedNames = new Set(['node_modules', '.git', '.DS_Store', '__tests__', 'coverage', 'dist', '.cache']);

/** Select portable assets before copying; refusing links avoids publishing files outside the source.
 * @throws On symlinks, special files or filesystem failures.
 * @complexity O(d) path segments per entry, without following excluded directory subtrees. */
async function selectAsset(required: { sourceDir: string; source: string; fs: AssemblyFilesystem }): Promise<boolean> {
  const segments = path.relative(required.sourceDir, required.source).split(path.sep);
  if (segments.some(segment => excludedNames.has(segment))) return false;
  if (/\.(?:test|spec)\./.test(path.basename(required.source)) || required.source.endsWith('.tsbuildinfo')) return false;
  const stat = await required.fs.lstat(required.source);
  if (!stat.isDirectory() && !stat.isFile()) throw new Error(`Agent plugin asset must be a regular file or directory: ${required.source}`);
  return true;
}

/** Assemble only the design plugin into a workspace package; preserve its inner manifest version.
 * @param required Source directory and reviewed destination package root.
 * @param optional Scratch output root and filesystem port for build-tool tests.
 * @returns The generated payload directory, ready for npm packing.
 * @throws On mismatched identities, missing required assets, unsafe entries or filesystem failures.
 * @complexity O(e + b) for e selected entries and b copied bytes. Staging completes before replacement.
 */
export async function assembleAgentPluginPackage(
  required: { sourceDir: string; packageRoot: string },
  optional: { outputRoot?: string; filesystem?: AssemblyFilesystem } = {},
): Promise<{ payloadRoot: string }> {
  const fs = optional.filesystem ?? filesystem;
  const manifest = JSON.parse(await fs.readFile(path.join(required.sourceDir, 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(path.join(required.packageRoot, 'package.json'), 'utf8'));
  if (manifest.name !== 'ui-ux-design' || pkg.name !== '@jini-ai/plugin-ui-ux-design') throw new Error('Agent plugin source and destination identities must agree');
  const outputRoot = optional.outputRoot ?? required.packageRoot;
  await fs.mkdir(outputRoot, { recursive: true });
  const staging = await fs.mkdtemp(path.join(outputRoot, '.agent-package-'));
  const payloadRoot = path.join(outputRoot, manifest.name);
  try {
    const stagedPayload = path.join(staging, manifest.name);
    await fs.mkdir(stagedPayload);
    for (const asset of assets) {
      await fs.cp(path.join(required.sourceDir, asset), path.join(stagedPayload, asset), {
        recursive: true,
        filter: source => selectAsset({ sourceDir: required.sourceDir, source, fs }),
      });
    }
    // Stage all selected bytes first: a bad source must not destroy the last completed payload.
    await fs.rm(payloadRoot, { recursive: true, force: true });
    await fs.rename(stagedPayload, payloadRoot);
    return { payloadRoot };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assembleAgentPluginPackage({
    sourceDir: fileURLToPath(new URL('../packages/agent-plugins/ui-ux-design/', import.meta.url)),
    packageRoot: fileURLToPath(new URL('../packages/plugin-ui-ux-design/', import.meta.url)),
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
