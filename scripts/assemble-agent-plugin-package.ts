/** Build-time asset assembly only; installed packages use the existing Agent Plugin lifecycle. */
import * as filesystem from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/is-main-module.js';
import {
  agentPluginPackageId, agentPluginPackageName, agentPluginPackageRoot, agentPluginPackages, type AgentPluginPackageRow,
} from './lib/agent-plugin-packages.js';

type AssemblyFilesystem = Pick<typeof filesystem, 'cp' | 'lstat' | 'mkdir' | 'mkdtemp' | 'readFile' | 'rename' | 'rm'>;
// The whole plugin folder ships minus these; `plugin.json` is the only required file, so client
// extension roots such as `com.anthropic.claude-code` and `mcp.json` are optional.
const excludedNames = new Set(['node_modules', '.git', '.DS_Store', '__tests__', 'coverage', 'dist', '.cache']);
const repoRoot = new URL('../', import.meta.url);

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
 * Copies the whole source folder through `selectAsset`, so the payload equals the authored plugin.
 * @param required Source directory and reviewed destination package root.
 * @param optional Scratch output root, filesystem port and layout rows (default: the reviewed table).
 * @returns The generated payload directory, ready for npm packing.
 * @throws On mismatched identities, missing required assets, unsafe entries or filesystem failures.
 * @complexity O(e + b) for e selected entries and b copied bytes. Staging completes before replacement.
 */
export async function assembleAgentPluginPackage(
  required: { sourceDir: string; packageRoot: string },
  optional: { outputRoot?: string; filesystem?: AssemblyFilesystem; rows?: readonly AgentPluginPackageRow[] } = {},
): Promise<{ payloadRoot: string }> {
  const fs = optional.filesystem ?? filesystem;
  const manifest = JSON.parse(await fs.readFile(path.join(required.sourceDir, 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(path.join(required.packageRoot, 'package.json'), 'utf8'));
  const row = (optional.rows ?? agentPluginPackages).find(entry => entry.name === manifest.name);
  if (!row || pkg.name !== agentPluginPackageName(row)) throw new Error('Agent plugin source and destination identities must agree');
  const outputRoot = optional.outputRoot ?? required.packageRoot;
  await fs.mkdir(outputRoot, { recursive: true });
  const staging = await fs.mkdtemp(path.join(outputRoot, '.agent-package-'));
  const payloadRoot = path.join(outputRoot, manifest.name);
  try {
    const stagedPayload = path.join(staging, manifest.name);
    await fs.cp(required.sourceDir, stagedPayload, {
      recursive: true,
      filter: source => selectAsset({ sourceDir: required.sourceDir, source, fs }),
    });
    // Stage all selected bytes first: a bad source must not destroy the last completed payload.
    await fs.rm(payloadRoot, { recursive: true, force: true });
    await fs.rename(stagedPayload, payloadRoot);
    return { payloadRoot };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

/** CLI: assemble every row of the named package (each package's build passes its own id), or all rows. */
async function main(required: { packageId: string | undefined }): Promise<void> {
  const selected = agentPluginPackages.filter(row => required.packageId === undefined || agentPluginPackageId(row) === required.packageId);
  if (selected.length === 0) throw new Error(`Unknown agent plugin package: ${required.packageId}`);
  for (const row of selected) {
    await assembleAgentPluginPackage({
      sourceDir: fileURLToPath(new URL(row.sourceDir, repoRoot)),
      packageRoot: fileURLToPath(new URL(agentPluginPackageRoot(row), repoRoot)),
    });
  }
}

if (isMainModule({ moduleUrl: import.meta.url, entryPath: process.argv[1] })) {
  main({ packageId: process.argv[2] }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
