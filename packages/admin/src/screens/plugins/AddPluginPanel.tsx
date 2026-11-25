import { agentHandle } from "@jini-ai/core/agent-handles";

import { InstallTabAdvanced, InstallTabCard, InstallTabFieldRow, InstallTabOption, ZipDropZone } from "../../shell/components/InstallTabCard/InstallTabCard.js";
import { UploadIcon } from "./agent-plugins-visuals.js";
import type { PluginInstallController } from "./hooks/use-plugin-install.hooks.js";

/**
 * The Plugins "Add a plugin" tab, on the shared `InstallTabCard` (owner, 2026-10-06 — replaces the
 * header "Install plugin" popup, whose raw file input and cramped layout "looks awful"). One `.zip`
 * or a picked folder (zipped in the browser), or — under "Advanced" — a folder path on the server,
 * then the replace option and Preview: the trust review must be seen before Install appears. The
 * server path is tucked away because it was a bare path with no button and read as broken (owner,
 * 2026-10-06). All state, async work and consent invalidation live in `use-plugin-install.hooks.ts`.
 *
 * Only rendered where the server allows local installs (`installSources`): elsewhere `Plugins.tsx`
 * greys the tab out with a "Soon" tag instead of offering fields that would only be refused.
 */
/** `productName` is the host product the server-path hint names (the computer running it). */
export function AddPluginPanel({ controller: c, productName }: { controller: PluginInstallController; productName: string }) {
  const { t } = c;
  return (
    <InstallTabCard titleId="plugins-add-title" title={t("Add a plugin")} lede={t("It stays off in every workspace until you turn it on.")}>
      <InstallTabOption heading={t("Upload a .zip or a folder")}>
        <ZipDropZone
          dropProps={agentHandle({ handle: "plugins-install-dropzone" }, { role: "region", label: t("Drop a .zip here") })}
          fileProps={agentHandle({ handle: "plugins-install-zip-input" }, { role: "field", label: t("Upload .zip (max 32 MiB)") })}
          drop={c.drop}
          glyph={<UploadIcon size={24} />}
          title={c.zipFile ? c.zipFile.name : t("Drop a .zip here")}
          hint={c.zipFile ? c.zipSizeLabel : t("A .zip or a plugin folder, up to 32 MiB.")}
          busy={c.busy}
          chooseLabel={t("Choose a file")}
          onChoose={c.onChooseZip}
          inputRef={c.zipInputRef}
          inputLabel={t("Upload .zip (max 32 MiB)")}
          onFileChange={c.onZipChange}
          chooseProps={agentHandle({ handle: "plugins-install-zip" }, { role: "button", label: "Choose a plugin .zip" })}
          folder={{
            inputProps: agentHandle({ handle: "plugins-install-folder-input" }, { role: "field", label: t("Choose a plugin folder") }),
            label: t("Choose a folder"),
            inputLabel: t("Choose a plugin folder"),
            onChoose: c.folderUpload.onChoose,
            inputRef: c.folderUpload.inputRef,
            onFilesChange: c.folderUpload.onChange,
            chooseProps: agentHandle({ handle: "plugins-install-folder-upload" }, { role: "button", label: "Choose a plugin folder to upload" }),
          }}
        />
        <InstallTabAdvanced summaryProps={agentHandle({ handle: "plugins-install-advanced" }, { role: "button", label: t("Advanced: install from a path on this server") })} summary={t("Advanced: install from a path on this server")} hint={t(`The full path of a plugin folder on the computer running ${productName}.`)}>
          <InstallTabFieldRow
            inputId="plugins-install-folder"
            label={t("Folder on this server")}
            value={c.folder}
            disabled={c.busy}
            onChange={c.onFolderChange}
            placeholder="/path/to/plugin"
            onSubmit={c.onSubmitFolder}
            inputProps={agentHandle({ handle: "plugins-install-folder" }, { role: "field", label: t("Folder on this server") })}
          />
        </InstallTabAdvanced>
      </InstallTabOption>
      <InstallTabOption>
        <label className="jini-install-tab-check">
          <input type="checkbox" checked={c.replace} disabled={c.busy} onChange={c.onReplaceChange} {...agentHandle({ handle: "plugins-install-replace" }, { role: "field", label: t("Replace existing version") })} />
          {t("Replace existing version")}
        </label>
        {c.previewDisplay ? <PluginInstallPreviewDetails controller={c} /> : null}
        {c.error ? <p className="jini-install-tab-alert" role="alert">{c.error}</p> : null}
        {c.installedMessage ? <p className="jini-install-tab-success" role="status">{c.installedMessage}</p> : null}
        <div className="jini-install-tab-actions">
          {c.preview ? (
            <>
              <button type="button" className="btn-secondary" disabled={c.busy} onClick={c.cancelReview} {...agentHandle({ handle: "plugins-install-cancel" }, { role: "button", label: t("Cancel") })}>{t("Cancel")}</button>
              <button type="button" className="btn-primary" disabled={c.busy} onClick={c.install} {...agentHandle({ handle: "plugins-install-confirm" }, { role: "button", label: t("Install (stays off)") })}>{t("Install (stays off)")}</button>
            </>
          ) : (
            <button type="button" className="btn-primary" disabled={c.reviewDisabled} onClick={c.review} {...agentHandle({ handle: "plugins-install-preview" }, { role: "button", label: t("Preview plugin") })}>{t("Preview plugin")}</button>
          )}
        </div>
      </InstallTabOption>
    </InstallTabCard>
  );
}

/** The trust review shown after Preview: what the package is, what it may do, and any clashes. */
function PluginInstallPreviewDetails({ controller: c }: { controller: PluginInstallController }) {
  const { t } = c;
  const d = c.previewDisplay;
  if (!d) throw new Error("plugin install review has no preview");
  return (
    <div className="jini-install-tab-review" aria-live="polite">
      <h3 className="jini-install-tab-option-heading">{d.title}</h3>
      <p>{t("Version")}: {d.version}</p>
      <p>{t("Tier")}: {d.tier} · {t("Local plugin · unverified publisher")}</p>
      <p>{t("Capabilities")}: {d.capabilities}</p>
      <p>{t("Hooks")}: {d.hooks}</p>
      <p>{t("Content types")}: {d.contentTypes}</p>
      <p><strong>{d.codeNotice}</strong></p>
      <p>{t("It stays off in every workspace until you turn it on.")}</p>
      {d.conflicts ? (
        <div className="jini-plugin-errors">
          <span className="save-error">{d.conflicts.heading}</span>
          <ul>
            {d.conflicts.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
