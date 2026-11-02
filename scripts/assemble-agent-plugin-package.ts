/** Build-time asset assembly for the legacy standalone package(s) published before subpaths
 * (`legacyAgentPluginPackages`). Every other agent plugin ships in place as an
 * `@jini-ai/agent-plugins/<name>` subpath and needs no assembly. Installed packages use the
 * existing Agent Plugin lifecycle. */
import * as filesystem from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/is-main-module.js';
import {
  agentPluginPackages, isPublishedAgentPluginFile, legacyAgentPluginPackages, type AgentPluginPackageRow,
} from './lib/agent-plugin-packages.js';

type AssemblyFilesystem = Pick<typeof filesystem, 'cp' | 'lstat' | 'mkdir' | 'mkdtemp' | 'readFile' | 'rename' | 'rm'>;
type LegacyPackages = Readonly<Record<string, string>>;
// The whole plugin folder ships minus `isPublishedAgentPluginFile` exclusions (the same rule as the
// agent-plugins tarball); `plugin.json` is the only required file, so client extension roots such as
// `com.anthropic.claude-code` and `mcp.json` are optional.
const repoRoot = new URL('../', import.meta.url);

/** Select portable assets before copying; refusing links avoids publishing files outside the source.
 * @throws On symlinks, special files or filesystem failures.
 * @complexity O(d) path segments per entry, without following excluded directory subtrees. */
async function selectAsset(required: { sourceDir: string; source: string; fs: AssemblyFilesystem }): Promise<boolean> {
  const relative = path.relative(required.sourceDir, required.source);
  if (relative !== '' && !isPublishedAgentPluginFile({ path: relative.split(path.sep).join('/') })) return false;
  const stat = await required.fs.lstat(required.source);
  if (!stat.isDirectory() && !stat.isFile()) throw new Error(`Agent plugin asset must be a regular file or directory: ${required.source}`);
  return true;
}

/** Assemble one reviewed agent plugin into its workspace package; preserve its inner manifest version.
 * Copies the whole source folder through `selectAsset`, so the payload equals the authored plugin.
 * @param required Source directory and reviewed destination package root.
 * @param optional Scratch output root, filesystem port, layout rows and legacy package names (defaults: the reviewed table).
 * @returns The generated payload directory, ready for npm packing.
 * @throws On mismatched identities, missing required assets, unsafe entries or filesystem failures.
 * @complexity O(e + b) for e selected entries and b copied bytes. Staging completes before replacement.
 */
export async function assembleAgentPluginPackage(
  required: { sourceDir: string; packageRoot: string },
  optional: { outputRoot?: string; filesystem?: AssemblyFilesystem; rows?: readonly AgentPluginPackageRow[]; legacyPackages?: LegacyPackages } = {},
): Promise<{ payloadRoot: string }> {
  const fs = optional.filesystem ?? filesystem;
  const manifest = JSON.parse(await fs.readFile(path.join(required.sourceDir, 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(path.join(required.packageRoot, 'package.json'), 'utf8'));
  const row = (optional.rows ?? agentPluginPackages).find(entry => entry.name === manifest.name);
  const legacyPackages = optional.legacyPackages ?? legacyAgentPluginPackages;
  if (!row || pkg.name !== legacyPackages[row.name]) throw new Error('Agent plugin source and destination identities must agree');
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

/** CLI: assemble the named plugin into its legacy package (`packages/plugin-<name>`). */
async function main(required: { name: string | undefined }): Promise<void> {
  const row = agentPluginPackages.find(entry => entry.name === required.name);
  const packageName = row && legacyAgentPluginPackages[row.name];
  if (!row || !packageName) throw new Error(`Not a legacy agent plugin package: ${required.name}`);
  await assembleAgentPluginPackage({
    sourceDir: fileURLToPath(new URL(row.sourceDir, repoRoot)),
    packageRoot: fileURLToPath(new URL(`packages/${packageName.slice('@jini-ai/'.length)}`, repoRoot)),
  });
}

if (isMainModule({ moduleUrl: import.meta.url, entryPath: process.argv[1] })) {
  main({ name: process.argv[2] }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
