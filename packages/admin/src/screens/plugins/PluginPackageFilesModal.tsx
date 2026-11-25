import type { AdminPluginDto } from "@jini-ai/core/contracts/site/cms-plugins";
import type { Translate } from "@jini-ai/core/text";
import { PackageFilesModal } from "./PackageFilesModal.js";
import type { PackageFilesStatus, PackageFileView } from "./rules.js";

/**
 * @file The Plugins screen's read-only package-files viewer — the same `PackageFilesModal` the Agent
 * Plugins screen opens, fed by the server's `PLUGIN_FILES` listing rather than a build-time catalog
 * (a `host-format plugin package` lands in the install directory at runtime, so no catalog could know its files).
 * Opened from a row's eye button on the Installed and Downloaded tabs (`PluginRow`'s `onInspect`).
 */

/** What the host's wired package-files hook hands the modal: the listing, the selection and the bound translator. */
export interface PluginPackageFiles {
  readonly files: readonly PackageFileView[];
  readonly selectedFile: PackageFileView | null;
  readonly selectFile: (relativePath: string) => void;
  readonly status: PackageFilesStatus | null;
  readonly listNotice: string | null;
  readonly t: Translate;
}

export interface PluginPackageFilesModalProps {
  readonly plugin: Pick<AdminPluginDto, "id" | "name">;
  readonly onClose: () => void;
  /** The host-bound listing hook (its request, locale and error describer); a test passes a fake. */
  readonly useFiles: (required: { pluginId: string }, optional?: Record<string, never>) => PluginPackageFiles;
}

export function PluginPackageFilesModal({ plugin, onClose, useFiles }: PluginPackageFilesModalProps) {
  const { files, selectedFile, selectFile, status, listNotice, t } = useFiles({ pluginId: plugin.id });

  return (
    <PackageFilesModal
      title={`${plugin.name} ${t("package files")}`}
      files={files}
      selectedFile={selectedFile}
      onSelectFile={selectFile}
      status={status}
      listNotice={listNotice}
      handlePrefix="plugin-file"
      t={t}
      onClose={onClose}
    />
  );
}
