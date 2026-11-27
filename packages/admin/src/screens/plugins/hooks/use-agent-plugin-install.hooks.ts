import { useRef, useState, type ChangeEvent } from "react";

import type { AgentPluginListRow } from "../../../agent-plugins/models.js";

import { useZipDrop } from "../../../shell/components/InstallTabCard/use-zip-drop.hooks.js";
import { useFolderUpload, type FolderZipPort } from "../../../shell/components/InstallTabCard/use-folder-upload.hooks.js";
import { formatByteSize } from "@jini-ai/core/text";
import type { PluginRules } from "../rules.js";
import type { IsInstallApiError } from "./use-plugin-install.hooks.js";
import type { AgentPluginInstallPort } from "../../integrations/agent-plugin-ports.js";

import { type Translate } from '@jini-ai/core/text';
/** The server's own cap (`install.ts`'s `maxArchiveBytes`), checked here first so an oversized file
 *  is refused before any bytes are hashed or sent. */
export const AGENT_PLUGIN_ZIP_MAX_BYTES = 32 * 1024 * 1024;

const TOO_LARGE = "The .zip is larger than the 32 MiB limit.";
const UNPACKED_TOO_LARGE = "The .zip is too big once unpacked: at most 4096 files, 16 MiB per file, 64 MiB in all.";
const RETRY = "Could not install the plugin. Try again.";
const RETRY_UPDATE = "Could not update the plugin. Try again.";
const NOT_ZIP = "This file is not a readable .zip.";
const ONE_ZIP = "Choose one .zip file.";

/** Server refusal code → dictionary key. Same plain words the route sends, translatable here. */
function errorKeys(productName: string): Readonly<Record<string, string>> {
  return {
  AGENT_PLUGIN_ARCHIVE_TOO_LARGE: TOO_LARGE,
  AGENT_PLUGIN_DIGEST_MISMATCH: "The upload arrived damaged. Try again.",
  AGENT_PLUGIN_MANIFEST_MISSING: "No plugin.json found. Put plugin.json at the top of the .zip, or inside one folder.",
  AGENT_PLUGIN_MANIFEST_INVALID: "plugin.json is not a valid Agent Plugin manifest.",
  AGENT_PLUGIN_ARCHIVE_UNREADABLE: NOT_ZIP,
  AGENT_PLUGIN_PLUGIN_ID_TAKEN: "This plugin ID is already installed. Choose Replace existing version to upgrade it.",
  AGENT_PLUGIN_PLUGIN_ENABLED: "Switch off the installed plugin before replacing its version.",
  AGENT_PLUGIN_PLUGIN_BUNDLED: "A bundled plugin owns this ID and cannot be replaced by an uploaded plugin.",
  AGENT_PLUGIN_TOO_MANY_ENTRIES: UNPACKED_TOO_LARGE,
  AGENT_PLUGIN_FILE_TOO_LARGE: UNPACKED_TOO_LARGE,
  AGENT_PLUGIN_DECOMPRESSION_BOMB: UNPACKED_TOO_LARGE,
  AGENT_PLUGIN_TOTAL_SIZE_EXCEEDED: UNPACKED_TOO_LARGE,
  AGENT_PLUGIN_ACTIVATIONS_BUSY: RETRY,
  // Update refusals (`AGENT_PLUGIN_UPDATE_ZIP`, 2026-10-21) carry the lifecycle owner's own codes.
  PLUGIN_CHANGED: "This plugin changed since this page loaded. Reload the page and try again.",
  PLUGIN_DOWNGRADE_REFUSED: "This package is an older version than the one installed.",
  PLUGIN_ID_MISMATCH: "This package is a different plugin.",
  PLUGIN_BUNDLED: `Plugins that ship with ${productName} update with ${productName}.`,
  PLUGIN_UPDATE_PENDING: `An earlier update is still being recovered. Restart ${productName} and try again.`,
  PLUGIN_HOST_INCOMPATIBLE: `This plugin is not made for this ${productName} version.`,
  PLUGIN_MCP_PROVISION_FAILED: "The new version's MCP servers could not be set up; the previous version was restored.",
  };
}

/** A refusal's dictionary key; `retry` is the install's or the update's own try-again line, used
 *  for anything unrecognised (an unknown 409 never shows the server's untranslated text).
 *  @complexity O(1). */
function errorKey(required: { error: unknown; retry: string; host: Pick<AgentPluginInstallHost, "isApiError" | "productName"> }, _optional: Record<string, never> = {}): string {
  const { error, retry, host } = required;
  if (!host.isApiError(error)) return retry;
  const keys = errorKeys(host.productName);
  // Own keys only: a server code such as "toString" must not resolve to an Object.prototype member.
  const known = error.code && Object.hasOwn(keys, error.code) ? keys[error.code] : undefined;
  if (known) return known;
  if (error.status === 403) return "You don't have permission to install plugins.";
  if (error.status === 400) return "This .zip contains files or links that plugins may not include.";
  return retry;
}

/** The success line: same bytes again, an update, or a fresh install (which is always off).
 *  @complexity O(1). */
function installedMessageKey({ alreadyInstalled, updating }: { alreadyInstalled: boolean; updating: boolean }): string {
  if (alreadyInstalled) return "{name} is already installed.";
  return updating ? "{name} is updated." : "{name} is installed and switched off. Turn it on in Installed.";
}

/** The upload panel's mode-specific copy, derived here so `AddAgentPluginPanel` only renders it:
 *  an update keeps its memory and on/off state, an install always stays off.
 *  @complexity O(1). */
function installLabels(required: { t: Translate; updating: boolean }, _optional: Record<string, never> = {}) {
  const { t, updating } = required;
  if (updating) {
    return { lede: t("Upload a newer version of this plugin as a .zip or a folder. It keeps its memory and stays on or off as it is now."),
      action: t("Update"), busyAction: t("Updating…"), actionAgentLabel: "Update the chosen Agent Plugin" };
  }
  return { lede: t("Install an Agent Plugin package from a .zip. New plugins stay off until you switch them on in Installed."),
    action: t("Install (stays off)"), busyAction: t("Installing…"), actionAgentLabel: "Install the chosen Agent Plugin (stays off)" };
}

/** Why `file` cannot be uploaded, as a dictionary key, or `null` when it can.
 *  @complexity O(1). */
function fileProblem(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".zip")) return ONE_ZIP;
  if (file.size === 0) return NOT_ZIP;
  if (file.size > AGENT_PLUGIN_ZIP_MAX_BYTES) return TOO_LARGE;
  return null;
}

/**
 * The "Add a plugin" tab's state: one chosen `.zip` (picker, drop, or a picked folder zipped in the
 * browser), its validation, and the upload. Installs never switch a plugin on; `onInstalled` hands the new row to the list so the
 * Installed tab shows it without a reload.
 */
/** The host collaborators the install and update controllers share: the product name the server's refusal copy names, the host's API-error test, and its bound rule functions. */
export interface AgentPluginInstallHost {
  readonly productName: string;
  readonly isApiError: IsInstallApiError;
  /** The host's folder zipper (this package never imports the implementation). */
  readonly folderZip: FolderZipPort;
  readonly rules: Pick<PluginRules, "agentPluginDisplayName" | "agentPluginWarningText">;
}

export function useAgentPluginInstall(
  required: { port: AgentPluginInstallPort; t: Translate; onInstalled: (row: AgentPluginListRow) => void } & AgentPluginInstallHost,
  options: { update?: { pluginId: string; expectedOldDigest: string } } = {},
) {
  const {
    port, t, onInstalled, folderZip, warnings, setWarnings, file, setFile, replace, setReplace, busy, setBusy, error, setError, installed, setInstalled, inputRef, locked,
    choose,
  } = useAgentPluginInstallState({ required });
  const { install } = createAgentPluginInstaller({ locked, file, setBusy, setError, port, replace, options, setWarnings, t, onInstalled, setInstalled, setFile, setReplace, host: required });
  const { drop, folderUpload } = useAgentPluginUploadSources({ locked, choose, setInstalled, setError, t, setFile, folderZip });

  const installedMessage = installed ? t(installedMessageKey({ alreadyInstalled: installed.alreadyInstalled, updating: options.update !== undefined })).replace("{name}", () => installed.name) : null;

  return {
    updating: options.update !== undefined,
    labels: installLabels({ t, updating: options.update !== undefined }),
    warnings,
    t,
    file,
    replace,
    onReplaceChange: (event: ChangeEvent<HTMLInputElement>) => setReplace(event.target.checked),
    fileSizeLabel: file ? formatByteSize({ bytes: file.size }, { megabyteLabel: "MiB" }) : "",
    drop,
    folderUpload,
    busy: busy || folderUpload.zipping,
    error,
    installedMessage,
    inputRef,
    installDisabled: busy || folderUpload.zipping || !file,
    onChooseFile: () => inputRef.current?.click(),
    onFileChange: (event: ChangeEvent<HTMLInputElement>) => choose({ next: event.target.files?.[0] ?? null }),
    onClearFile: () => choose({ next: null }),
    install: () => void install(),
  };
}

function useAgentPluginUploadSources(
  { locked, choose, setInstalled, setError, t, setFile, folderZip }:
    Pick<ReturnType<typeof useAgentPluginInstallState>, "locked" | "choose" | "setInstalled" | "setError" | "t" | "setFile" | "folderZip">
) {
  const drop = useZipDrop({
    isLocked: () => locked.current,
    onDropFiles: ({ files }, _optional = {}) => {
      const file = files[0];
      if (files.length === 1 && file) choose({ next: file });
      else {
        setInstalled(null);
        setError(t(ONE_ZIP));
      }
    },
  });

  // A picked folder becomes `<folder>.zip` and goes through `choose` like any picked zip.
  const folderUpload = useFolderUpload({
    folderZip,
    maxBytes: AGENT_PLUGIN_ZIP_MAX_BYTES,
    tooLarge: TOO_LARGE,
    isLocked: () => locked.current,
    onZipped: (next) => choose({ next }),
    onError: ({ key }, _optional = {}) => {
      setInstalled(null);
      setFile(null);
      setError(t(key));
    },
  });
  return { drop, folderUpload };
}

function createAgentPluginInstaller(
  { locked, file, setBusy, setError, port, replace, options, setWarnings, t, onInstalled, setInstalled, setFile, setReplace, host }:
    Pick<ReturnType<typeof useAgentPluginInstallState>, "locked" | "file" | "setBusy" | "setError" | "port" | "replace" | "setWarnings" | "t" | "onInstalled"
    | "setInstalled" | "setFile" | "setReplace"> &
    { options: NonNullable<Parameters<typeof useAgentPluginInstall>[1]>; host: AgentPluginInstallHost }
) {
  async function install(): Promise<void> {
    if (locked.current || !file) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await port.installZip({ file, sha256: await port.sha256({ file }), replace, ...(options.update ? { update: options.update } : {}) });
      setWarnings((result.warnings ?? []).map((warning) => host.rules.agentPluginWarningText({ warning, translate: t })));
      if (result.agentPlugin) onInstalled(result.agentPlugin);
      setInstalled({ name: result.agentPlugin ? host.rules.agentPluginDisplayName(result.agentPlugin) : file.name, alreadyInstalled: result.alreadyInstalled });
      setFile(null);
      setReplace(false);
    } catch (e) {
      setError(t(errorKey({ error: e, retry: options.update ? RETRY_UPDATE : RETRY, host })));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { install };
}

function useAgentPluginInstallState(
  { required }:
    { required: Parameters<typeof useAgentPluginInstall>[0] }
) {
  const { port, t, onInstalled, folderZip } = required;
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<{ name: string; alreadyInstalled: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const locked = useRef(false);

  function choose({ next }: { next: File | null }, _optional = {}): void {
    setError(null);
    setWarnings([]);
    setInstalled(null);
    // Replacement is an explicit choice for these bytes; picking another package revokes it.
    setReplace(false);
    if (inputRef.current) inputRef.current.value = "";
    const problem = next ? fileProblem(next) : null;
    setFile(problem ? null : next);
    if (problem) setError(t(problem));
  }
  return {
    port, t, onInstalled, folderZip, warnings, setWarnings, file, setFile, replace, setReplace, busy, setBusy, error, setError, installed, setInstalled, inputRef, locked,
    choose,
  };
}

export type AgentPluginInstallController = ReturnType<typeof useAgentPluginInstall>;
