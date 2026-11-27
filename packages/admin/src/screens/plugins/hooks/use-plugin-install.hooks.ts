import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import type { PluginInstallPort, PluginInstallPreview, PluginInstallSource } from "./plugin-install-port.hooks.js";
import type { PluginRules } from "../rules.js";
import { useZipDrop } from "../../../shell/components/InstallTabCard/use-zip-drop.hooks.js";
import { useFolderUpload, type FolderZipPort } from "../../../shell/components/InstallTabCard/use-folder-upload.hooks.js";
import { formatByteSize } from "@jini-ai/core/text";

import { type Translate } from '@jini-ai/core/text';
const ZIP_MAX_BYTES = 32 * 1024 * 1024;
const TOO_LARGE = "ZIP exceeds the upload or expanded package size limit.";

/** Server refusal code → dictionary key. */
const ERROR_CODE_KEYS: Readonly<Record<string, string>> = {
  PLUGIN_CHANGED_SINCE_PREVIEW: "Package changed. Review it again before installing.",
  PLUGIN_LOCAL_INSTALL_DISABLED: "Local folder installs are disabled on this server.",
  PLUGIN_IN_TRASH: "This plugin is already in the Trash. Restore or delete it there first.",
  PLUGIN_ENABLED: "Turn this plugin off in every workspace before installing.",
  PLUGIN_PACKAGE_TOO_LARGE: TOO_LARGE,
};
/** HTTP status → dictionary key, for a refusal without a known code. */
const ERROR_STATUS_KEYS: Readonly<Record<number, string>> = {
  413: TOO_LARGE,
  409: "Installation conflicts with an existing plugin. Check its version and replacement option.",
  400: "Invalid plugin package. Check its manifest, integrity and folder.",
};

/** The slice of the host's API error class this hook reads: the server's refusal code and the HTTP status. */
export interface InstallApiError { readonly code?: string | undefined; readonly status: number }

/** The host's own error-class test (an `instanceof` over its request layer's error), injected because this package never imports the host's request layer. */
export type IsInstallApiError = (error: unknown) => error is InstallApiError;

function errorKey({ error, fallback, isApiError }: { error: unknown; fallback: string; isApiError: IsInstallApiError }, _optional = {}): string {
  if (!isApiError(error)) return fallback;
  // Own keys only: a server code such as "toString" must not resolve to an Object.prototype member.
  const known = error.code && Object.hasOwn(ERROR_CODE_KEYS, error.code) ? ERROR_CODE_KEYS[error.code] : undefined;
  return known ?? ERROR_STATUS_KEYS[error.status] ?? fallback;
}

/** The sentence key for a failed preview or install: the error's own when it has one, else a generic one. */
function installFailureKey({ error, install, isApiError }: { error: unknown; install: boolean; isApiError: IsInstallApiError }, _optional = {}): string {
  return errorKey({ error, isApiError, fallback: install ? "Failed to install plugin." : "Failed to preview plugin." });
}

/**
 * The Plugins "Add a plugin" tab's state: a server folder or one uploaded `.zip` (picker, drop, or a
 * picked folder zipped in the browser), the replace option, the preview (trust review) and the
 * install it unlocks. Changing any input invalidates the preview, so an install always matches what
 * was reviewed.
 */
export function usePluginInstall(required: { port: PluginInstallPort; t: Translate; onInstalled: () => Promise<void>; isApiError: IsInstallApiError; folderZip: FolderZipPort; rules: Pick<PluginRules, "pluginInstallPreviewDisplay"> }, _optional = {}) {
  const [folder, setFolder] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const [replace, setReplace] = useState(false);
  const [preview, setPreview] = useState<PluginInstallPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installedName, setInstalledName] = useState<string | null>(null);
  const sequence = useRef(0);
  const locked = useRef(false);
  useEffect(() => () => { sequence.current++; }, []);
  function invalidate() { sequence.current++; setPreview(null); setError(null); setInstalledName(null); }
  function clearZipInput() { if (zipInputRef.current) zipInputRef.current.value = ""; }
  function chooseZip({ file }: { file: File | null }, _optional = {}) {
    invalidate(); setFolder(""); clearZipInput();
    if (file && file.size > ZIP_MAX_BYTES) { setZipFile(null); setError(required.t(TOO_LARGE)); }
    else setZipFile(file);
  }
  function chooseFolder({ value }: { value: string }, _optional = {}) { invalidate(); setFolder(value); setZipFile(null); clearZipInput(); }
  function chooseReplace({ value }: { value: boolean }, _optional = {}) { invalidate(); setReplace(value); }
  function hasSource() { return folder.trim() !== "" || zipFile !== null; }
  function canRun({ install }: { install: boolean }, _optional = {}) { return !locked.current && hasSource() && (!install || preview !== null); }
  function currentSource(): PluginInstallSource {
    return { source: zipFile ? { kind: "zip", file: zipFile } : { kind: "folder", path: folder.trim() }, replace };
  }
  /** Runs one preview or install under the lock; a result is dropped if the inputs changed meanwhile. */
  async function perform({ install }: { install: boolean }, _optional = {}) {
    if (!canRun({ install })) return;
    locked.current = true; setBusy(true); setError(null); setInstalledName(null);
    sequence.current += 1;
    const generation = sequence.current;
    const source = currentSource();
    try {
      await runSource({ install, source, generation });
    } catch (e) {
      // A failure of a superseded run is dropped; the current run clears its preview and says why.
      if (generation !== sequence.current) return;
      setPreview(null); setError(required.t(installFailureKey({ error: e, install, isApiError: required.isApiError })));
    } finally { locked.current = false; setBusy(false); }
  }
  async function runSource({ install, source, generation }: { install: boolean; source: PluginInstallSource; generation: number }, _optional = {}) {
    if (!install) { await reviewSource({ source, generation }); return; }
    if (!preview) throw new Error("plugin install has no reviewed preview");
    await installReviewed({ source, reviewed: preview, generation });
  }
  async function reviewSource({ source, generation }: { source: PluginInstallSource; generation: number }, _optional = {}) {
    const result = await required.port.preview(source);
    if (generation === sequence.current) setPreview(result.plugin);
  }
  async function installReviewed({ source, reviewed, generation }: { source: PluginInstallSource; reviewed: PluginInstallPreview; generation: number }, _optional = {}) {
    await required.port.install({ ...source, expectedDigest: reviewed.digest });
    if (generation !== sequence.current) return;
    await required.onInstalled();
    if (generation !== sequence.current) return;
    setInstalledName(reviewed.name); setPreview(null); setFolder(""); setZipFile(null); setReplace(false); clearZipInput();
  }
  const drop = useZipDrop({ isLocked: () => locked.current, onDropFiles: ({ files }, _optional = {}) => chooseZip({ file: files[0] ?? null }) });
  // A picked folder becomes `<folder>.zip` and then IS the chosen zip: same limit, preview, install.
  const folderUpload = useFolderUpload({
    folderZip: required.folderZip, maxBytes: ZIP_MAX_BYTES, tooLarge: TOO_LARGE, isLocked: () => locked.current, onZipped: (file) => chooseZip({ file }),
    onError: ({ key }, _optional = {}) => { invalidate(); setZipFile(null); setError(required.t(key)); },
  });
  return {
    folder, zipFile, zipInputRef, replace, preview, error, drop, folderUpload, t: required.t,
    busy: busy || folderUpload.zipping,
    zipSizeLabel: zipFile ? formatByteSize({ bytes: zipFile.size }, { megabyteLabel: "MiB" }) : "",
    reviewDisabled: busy || folderUpload.zipping || !hasSource(),
    previewDisplay: preview ? required.rules.pluginInstallPreviewDisplay({ preview, translate: required.t }) : null,
    installedMessage: installedName ? required.t("{name} is installed and switched off. Turn it on in Downloaded.").replace("{name}", () => installedName) : null,
    setFolder: chooseFolder,
    onFolderChange: (event: ChangeEvent<HTMLInputElement>) => chooseFolder({ value: event.target.value }),
    onSubmitFolder: (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void perform({ install: false }); },
    setZipFile: chooseZip,
    onChooseZip: () => zipInputRef.current?.click(),
    onZipChange: (event: ChangeEvent<HTMLInputElement>) => chooseZip({ file: event.target.files?.[0] ?? null }),
    setReplace: chooseReplace,
    onReplaceChange: (event: ChangeEvent<HTMLInputElement>) => chooseReplace({ value: event.target.checked }),
    cancelReview: () => { if (!locked.current) invalidate(); },
    review: () => perform({ install: false }), install: () => perform({ install: true }),
  };
}
export type PluginInstallController = ReturnType<typeof usePluginInstall>;
