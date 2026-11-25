import { agentHandle } from "@jini-ai/core/agent-handles";

import { InstallTabCard, InstallTabFieldRow, InstallTabOption, ZipDropZone } from "../../shell/components/InstallTabCard/InstallTabCard.js";
import { UploadIcon } from "./agent-plugins-visuals.js";
import type { AgentPluginInstallController } from "./hooks/use-agent-plugin-install.hooks.js";

/**
 * The Agent Plugins "Add a plugin" tab: upload one `.zip` (drop or pick) or a picked folder (zipped
 * in the browser), installed switched off.
 * "From a URL" is shown disabled as Coming soon: the server has no fetch-and-install route yet, so
 * a working-looking field would be one the operator tries and fails. State lives in
 * `use-agent-plugin-install.hooks.ts`; the card is the shared `InstallTabCard` Skills and Plugins
 * use too.
 */
export function AddAgentPluginPanel({ controller: c, handleBase = "agent-plugin-add", title }: {
  controller: AgentPluginInstallController;
  /** Agent-handle and id prefix. A row's Update panel passes its own, so it never collides with
   *  the Add tab's (or another row's) handles and heading id. */
  handleBase?: string;
  /** Heading override; the Update panel names the plugin it updates. */
  title?: string;
}) {
  const { t } = c;
  return (
    <InstallTabCard
      titleId={`${handleBase}-title`}
      title={title ?? t("Add a plugin")}
      lede={c.labels.lede}
    >
      <InstallTabOption heading={t("Upload a .zip or a folder")}>
        <ZipDropZone
          dropProps={agentHandle({ handle: `${handleBase}-dropzone` }, { role: "region", label: t("Drop a .zip here") })}
          fileProps={agentHandle({ handle: `${handleBase}-file-input` }, { role: "field", label: t("Upload a .zip") })}
          drop={c.drop}
          glyph={<UploadIcon size={24} />}
          title={c.file ? c.file.name : t("Drop a .zip here")}
          hint={c.file ? c.fileSizeLabel : t("An agent-plugins.org package with plugin.json at its top. Up to 32 MiB.")}
          busy={c.busy}
          chooseLabel={t("Choose a file")}
          onChoose={c.onChooseFile}
          inputRef={c.inputRef}
          inputLabel={t("Upload a .zip")}
          onFileChange={c.onFileChange}
          chooseProps={agentHandle({ handle: `${handleBase}-choose` }, { role: "button", label: "Choose an Agent Plugin .zip" })}
          folder={{
            inputProps: agentHandle({ handle: `${handleBase}-folder-input` }, { role: "field", label: t("Choose a plugin folder") }),
            label: t("Choose a folder"),
            inputLabel: t("Choose a plugin folder"),
            onChoose: c.folderUpload.onChoose,
            inputRef: c.folderUpload.inputRef,
            onFilesChange: c.folderUpload.onChange,
            chooseProps: agentHandle({ handle: `${handleBase}-choose-folder` }, { role: "button", label: "Choose an Agent Plugin folder to upload" }),
          }}
        />
        {!c.updating ? <>
          <label className="jini-install-tab-check">
            <input type="checkbox" checked={c.replace} disabled={c.busy} onChange={c.onReplaceChange}
              {...agentHandle({ handle: `${handleBase}-replace` }, { role: "field", label: t("Replace existing version") })} />
            {t("Replace existing version")}
          </label>
          <p className="field-hint">{t("Replaces the installed version with a newer one. Older versions are refused.")}</p>
        </> : null}
        <AgentPluginUploadStatus controller={c} />
        <AgentPluginUploadActions controller={c} handleBase={handleBase} />
      </InstallTabOption>

      {!c.updating ? <InstallTabOption heading={t("From a URL")} badge={t("Coming soon")} hint={t("Install from a repository or a .zip link.")}>
        <InstallTabFieldRow
          inputId="agent-plugin-add-url"
          type="url"
          disabled
          placeholder="https://example.test/owner/plugin"
          inputProps={{ "aria-label": t("Plugin URL"), ...agentHandle({ handle: `${handleBase}-url` }, { role: "field", label: t("Plugin URL") }) }}
          actionProps={agentHandle({ handle: `${handleBase}-from-url` }, { role: "button", label: t("Add from URL") })}
          action={{ label: t("Add from URL"), disabled: true }}
        />
      </InstallTabOption> : null}
    </InstallTabCard>
  );
}

/** The upload's outcome lines: lifecycle warnings, the refusal, and the success line. */
function AgentPluginUploadStatus({ controller: c }: { controller: AgentPluginInstallController }) {
  return (
    <>
      {c.warnings.length > 0 ? (
        <div className="jini-install-tab-review" role="status">
          {c.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      ) : null}
      {c.error ? (
        <p className="jini-install-tab-alert" role="alert">
          {c.error}
        </p>
      ) : null}
      {c.installedMessage ? (
        <p className="jini-install-tab-success" role="status">
          {c.installedMessage}
        </p>
      ) : null}
    </>
  );
}

/** The install/update button; its mode-specific words come from the controller's `labels`. */
function AgentPluginUploadActions({ controller: c, handleBase }: { controller: AgentPluginInstallController; handleBase: string }) {
  return (
    <div className="jini-install-tab-actions">
      <button
        type="button"
        className="btn-primary"
        disabled={c.installDisabled}
        onClick={c.install}
        {...agentHandle({ handle: `${handleBase}-install` }, { role: "button", label: c.labels.actionAgentLabel })}
      >
        {c.busy ? c.labels.busyAction : c.labels.action}
      </button>
    </div>
  );
}
