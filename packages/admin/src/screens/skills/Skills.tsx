import { agentHandle } from "@jini-ai/core/agent-handles";
import { ErrorNotice, Icon, SettingsDialogShell, type SettingsDialogTab } from "../../react/kit.js";
import { SkillInstallConfirmation } from "./SkillInstallConfirmation.js";
import { SkillRemoveConfirmDialog } from "./SkillRemoveConfirmDialog.js";
import { SkillRow } from "./SkillRow.js";
import type { SkillFailureHost, SkillsScreenClassNames, SkillsScreenComponents, SkillsScreenController as SkillsController, SkillsScreenHooks } from "./skills-screen.types.js";
import { type Translate } from '@jini-ai/core/text';
const SKILL_FILE_ACCEPT = ".zip,.md,.txt,.json,.yaml,.yml,.csv,.svg,.sh,.py,.js,.ts,.mjs,.png,.jpg,.jpeg,.webp";

/** Installed rows and their loading/empty states share the default Skills tab. */
function InstalledSkillsPanel({ controller, t, PlainTextBlocks, classNames: cx }: { controller: SkillsController; t: Translate; PlainTextBlocks: SkillsScreenComponents<object>["PlainTextBlocks"]; classNames: SkillsScreenClassNames }) {
  return (
    <>
      {controller.loading ? <div className={cx.notice} role="status">{t("Loading skills…")}</div> : null}
      {controller.empty ? (
        <div className={cx.card}>
          <div className={cx.emptyState} role="status">
            <p>{t("No skills installed yet")}</p>
            <p className={cx.pageDescription}>{t("Add a GitHub skill or upload files to get started.")}</p>
            <button type="button" className={cx.buttonPrimary} onClick={controller.onShowAdd}>{t("Add a skill")}</button>
          </div>
        </div>
      ) : null}
      {controller.rows.length > 0 ? (
        <ul className={cx.rows} aria-label={t("Installed skills")}>
          {controller.rows.map(row => <SkillRow key={row.skill.toolId} row={row} t={t} PlainTextBlocks={PlainTextBlocks} classNames={cx} />)}
        </ul>
      ) : null}
    </>
  );
}

/** Install inputs keep their values and pending confirmation in the page controller. */
function AddSkillPanel({ controller, t, components, classNames: cx }: { controller: SkillsController; t: Translate; components: Pick<SkillsScreenComponents<object>, "InstallTabCard" | "InstallTabOption" | "InstallTabFieldRow">; classNames: SkillsScreenClassNames }) {
  const { InstallTabCard, InstallTabOption, InstallTabFieldRow } = components;
  return (
    <InstallTabCard titleId="skills-add-title" title={t("Add a skill")}>
      <InstallTabOption>
        <InstallTabFieldRow
          inputProps={agentHandle({ handle: "skills-add-url-input" }, { role: "field", label: t("GitHub URL") })}
          actionProps={agentHandle({ handle: "skills-add-url" }, { role: "button", label: t("Add from GitHub") })}
          inputId="skills-github-url"
          label={t("GitHub URL")}
          value={controller.githubUrl}
          onChange={controller.onGithubUrlChange}
          placeholder="https://github.com/owner/skill"
          onSubmit={controller.onSubmitGithub}
          action={{ label: t("Add from GitHub"), disabled: controller.githubDisabled, primary: true }}
        />
        <div className={cx.editorActions}>
          <button type="button" className={cx.buttonSecondary} disabled={controller.addBusy} onClick={controller.onChooseFiles} {...agentHandle({ handle: "skills-add-files" }, { role: "button", label: t("Upload files") })}>{t("Upload files")}</button>
          <button type="button" className={cx.buttonSecondary} disabled={controller.addBusy} onClick={controller.onChooseFolder} {...agentHandle({ handle: "skills-add-folder" }, { role: "button", label: t("Upload folder") })}>{t("Upload folder")}</button>
        </div>
      </InstallTabOption>
      <input ref={controller.filesInput} {...agentHandle({ handle: "skills-add-files-input" }, { role: "field", label: t("Choose skill files") })} className="jini-skills-file-input" type="file" aria-label={t("Choose skill files")} multiple accept={SKILL_FILE_ACCEPT} onChange={controller.onFilesChange} hidden />
      <input ref={controller.folderInput} {...agentHandle({ handle: "skills-add-folder-input" }, { role: "field", label: t("Choose skill folder") })} className="jini-skills-file-input" type="file" aria-label={t("Choose skill folder")} multiple {...{ webkitdirectory: "" }} onChange={controller.onFilesChange} hidden />
    </InstallTabCard>
  );
}

/** The failure notice and the two dialogs the page raises; split out so the page body stays under the complexity ceiling. */
function SkillsOverlays<TFilesModal extends object>({ controller, t, filesModal, PackageFilesModal, classNames }: { controller: SkillsController; t: Translate; filesModal: TFilesModal | null; PackageFilesModal: SkillsScreenComponents<TFilesModal>["PackageFilesModal"]; classNames: SkillsScreenClassNames }) {
  return (
    <>
      {controller.failure ? <ErrorNotice failure={controller.failure} t={t} /> : null}
      {controller.removing ? <SkillRemoveConfirmDialog controller={controller} t={t} classNames={classNames} /> : null}
      {filesModal ? <PackageFilesModal {...filesModal} /> : null}
    </>
  );
}

/** Agent Plugins' shared tab shell; navigation and installation behavior live in hooks. */
export function Skills<TFilesModal extends object>({ hooks, components, failureHost, classNames }: {
  hooks: SkillsScreenHooks<TFilesModal>;
  components: SkillsScreenComponents<TFilesModal>;
  failureHost: SkillFailureHost;
  classNames: SkillsScreenClassNames;
}) {
  const themeBoundary = hooks.useAdminThemeBoundary({}, {});
  const locale = hooks.useLocale();
  const t = hooks.useSkillsTranslator({ locale });
  const controller = hooks.useSkills({ t });
  const filesModal = hooks.useSkillFilesModal({ skill: controller.inspecting, onClose: controller.onCloseFiles }, { t });
  const tabs: SettingsDialogTab[] = [
    { id: "skills", label: t("Skills"), icon: <Icon name="document-marked" size={18} strokeWidth={1.5} />, title: t("Skills"), subtitle: t("Instructions for your assistant. Type /sk in chat to use one."), panel: <InstalledSkillsPanel controller={controller} t={t} PlainTextBlocks={components.PlainTextBlocks} classNames={classNames} /> },
    { id: "add", label: t("Add a skill"), title: t("Skills"), subtitle: t("Instructions for your assistant. Type /sk in chat to use one."), panel: <AddSkillPanel controller={controller} t={t} components={components} classNames={classNames} /> },
  ];
  return (
    // Classic keeps its unverified-dark light pin; Glass follows the document scheme.
    <section className={`${classNames.page} jini-skills-page ${classNames.section}`} {...themeBoundary} aria-label={t("Skills")}>
      <SettingsDialogShell
        tabs={tabs}
        activeTabId={controller.activeTabId}
        onActiveTabIdChange={controller.onTabChange}
        presentation="inline"
        className="jini-tabbed-dialog--inline"
        fullscreenEnabled={false}
        dialogAriaLabelledBy="skills-page-title"
        labels={{ kicker: t("Add-Ons"), sidebarAriaLabel: t("Skills sections") }}
      />
      <SkillInstallConfirmation install={controller.install} locale={locale} hooks={hooks} failureHost={failureHost} classNames={classNames} />
      <SkillsOverlays controller={controller} t={t} filesModal={filesModal} PackageFilesModal={components.PackageFilesModal} classNames={classNames} />
      <p className={classNames.fieldHint}>{t("Skills work with Claude Code, Codex and BYOK. Aider, Gemini CLI and Pi can't use them.")}</p>
    </section>
  );
}
