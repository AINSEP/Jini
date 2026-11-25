import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Per-entry export decision, independent of archive claims and execution trust. */
export type BundledExportFileDisposition = 'scan' | 'skip';

/** Reads the installed copy of one bundled plugin file; `null` when this build has no such copy. */
export type ReadBundledExportFile = (required: { pluginId: string; relativePath: string }) => Promise<Uint8Array | null>;

/** Per-entry export decision, independent of archive claims and execution trust. */
export type BundledExportFilePolicy = (required: { path: string; bytes: Uint8Array }) => Promise<BundledExportFileDisposition>;

/** The host's byte-comparison rule: whether an archive entry equals the installed bundled copy. */
export type ClassifyBundledExportFile = (required: {
  pluginId: string; relativePath: string; bytes: Uint8Array; readFile: ReadBundledExportFile;
}) => Promise<BundledExportFileDisposition>;

/** Host values the policy cannot know: which packages ship, how to find them, and how to compare. */
export interface BundledExportFilePolicyDeps {
  /** Selected plugin id -> installed package specifier. */
  selection: ReadonlyMap<string, string>;
  /** Module resolution of the host's installed packages (`require.resolve` shape). */
  resolve: (specifier: string) => string;
  classifyBundledPluginFile: ClassifyBundledExportFile;
}

/**
 * Wire a host byte comparison to the host's selected npm subpaths. Resolve each selected root once per
 * export; read only the corresponding installed file. Custom paths and unavailable copies scan.
 * @returns An export-local policy; no inventory, persistent cache, network or content mutation.
 * @complexity One resolution per encountered plugin, one file read per selected package entry.
 * @example const policy = createBundledExportFilePolicy({ selection, resolve, classifyBundledPluginFile }); await policy({ path, bytes });
 */
export function createBundledExportFilePolicy(required: BundledExportFilePolicyDeps, optional: {
  readFile?: (filename: string) => Promise<Uint8Array>;
} = {}): BundledExportFilePolicy {
  const { selection, resolve, classifyBundledPluginFile } = required;
  const read = optional.readFile ?? readFile;
  const roots = new Map<string, string | null>();
  const readBundledFile: ReadBundledExportFile = async ({ pluginId, relativePath }) => {
    const specifier = selection.get(pluginId);
    if (!specifier) return null;
    if (!roots.has(pluginId)) {
      try { roots.set(pluginId, path.dirname(resolve(`${specifier}/plugin.json`))); }
      catch { roots.set(pluginId, null); }
    }
    const root = roots.get(pluginId);
    if (root === undefined) throw new Error(`Bundled plugin ${pluginId} has no resolved root`);
    if (root === null) return null;
    return read(path.join(root, relativePath));
  };
  return async ({ path: archivePath, bytes }) => {
    const match = /^agent-plugins\/([^/]+)\/package\/(.+)$/.exec(archivePath);
    if (!match) return 'scan';
    return classifyBundledPluginFile({ pluginId: match[1]!, relativePath: match[2]!, bytes, readFile: readBundledFile });
  };
}
