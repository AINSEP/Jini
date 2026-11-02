/** Build-time asset assembly only; installed packages use the existing Agent Plugin lifecycle. */
import * as filesystem from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/is-main-module.js';

type AssemblyFilesystem = Pick<typeof filesystem, 'cp' | 'lstat' | 'mkdir' | 'mkdtemp' | 'readFile' | 'rename' | 'rm'>;
const assets = ['plugin.json', 'mcp.json', 'skills', 'com.anthropic.claude-code'] as const;
const excludedNames = new Set(['node_modules', '.git', '.DS_Store', '__tests__', 'coverage', 'dist', '.cache']);
/** Reviewed source → package pairs; paths are relative to this script. */
export const agentPluginPackages = [
  { name: 'slide-design', sourceDir: '../packages/agent-plugins/slide-design/', packageRoot: '../packages/plugin-slide-design/' },
  { name: 'ui-ux-design', sourceDir: '../packages/agent-plugins/ui-ux-design/', packageRoot: '../packages/plugin-ui-ux-design/' },
] as const;

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

/** Assemble one reviewed agent plugin into its workspace package; preserve its inner manifest version.
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
  const known = agentPluginPackages.some(entry => entry.name === manifest.name);
  if (!known || pkg.name !== `@jini-ai/plugin-${manifest.name}`) throw new Error('Agent plugin source and destination identities must agree');
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

/** CLI: assemble the named plugin (each package's build passes its own name), or every plugin. */
async function main(required: { name: string | undefined }): Promise<void> {
  const selected = agentPluginPackages.filter(entry => required.name === undefined || entry.name === required.name);
  if (selected.length === 0) throw new Error(`Unknown agent plugin package: ${required.name}`);
  for (const entry of selected) {
    await assembleAgentPluginPackage({
      sourceDir: fileURLToPath(new URL(entry.sourceDir, import.meta.url)),
      packageRoot: fileURLToPath(new URL(entry.packageRoot, import.meta.url)),
    });
  }
}

if (isMainModule({ moduleUrl: import.meta.url, entryPath: process.argv[1] })) {
  main({ name: process.argv[2] }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
