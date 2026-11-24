import type { agentHandle as AgentHandle } from "@jini-ai/core/agent-handles";

import type { GitBackupController } from "./hooks/use-git-backup.hooks.js";

import { type Translate, interpolate } from '@jini-ai/core/text';
/**
 * @file The Import & Export panel's Git backup card: commit this site to a private repository with
 * a saved Source Control connection. Markup only; every effect is in `use-git-backup.hooks.ts`, and
 * the server side is the same service as the assistant's `site_backup_plan`/`site_backup_push`.
 * Classes are `jini-*`: the generic card/field/button/notice aliases plus `jini-import-export-*`
 * (host aliases of its `import-export-card*` and `git-backup-*` rules).
 */

export const SOURCE_CONTROL_HREF = "/admin/source-control";

export interface GitBackupCardProps {
  controller: GitBackupController;
  t: Translate;
  /** Core's `agentHandle`, injected by the host (never imported here). */
  agentHandle: typeof AgentHandle;
}

export function GitBackupCard({ controller, t, agentHandle }: GitBackupCardProps) {
  return (
    <section
      className="jini-card jini-import-export-card jini-import-export-card-wide"
      aria-labelledby="import-export-git-backup-title"
      {...agentHandle({ handle: "import-export-git-backup-card" }, { role: "region", label: "Back up this site to a private Git repository" })}
    >
      <h2 id="import-export-git-backup-title" className="jini-card-title">{t("Git backup")}</h2>
      <p className="jini-card-lead">{t("Commit this site to a private Git repository.")}</p>
      <GitBackupBody controller={controller} t={t} agentHandle={agentHandle} />
    </section>
  );
}

function GitBackupBody({ controller, t, agentHandle }: GitBackupCardProps) {
  if (controller.connectionsError) return <div className="jini-notice jini-notice-error" role="alert">{controller.connectionsError}</div>;
  if (!controller.connections) return <div className="jini-notice">{t("Loading connections…")}</div>;
  if (controller.connections.length === 0) return <NoConnection t={t} agentHandle={agentHandle} />;
  if (controller.phase === "planned" || controller.phase === "pushing") return <PlanSummary controller={controller} t={t} agentHandle={agentHandle} />;
  if (controller.phase === "done") return <BackupDone controller={controller} t={t} agentHandle={agentHandle} />;
  if (controller.phase === "refused") return <BackupRefused controller={controller} t={t} agentHandle={agentHandle} />;
  return <GitBackupFormFields controller={controller} connections={controller.connections} t={t} agentHandle={agentHandle} />;
}

function NoConnection({ t, agentHandle }: { t: Translate; agentHandle: typeof AgentHandle }) {
  return (
    <>
      <p className="jini-import-export-git-backup-note">{t("No Git connection yet.")}</p>
      <a className="jini-btn-secondary" href={SOURCE_CONTROL_HREF} {...agentHandle({ handle: "import-export-git-backup-source-control-link" }, { role: "link", label: "Open Source Control to connect a Git host" })}>
        {t("Open Source Control")}
      </a>
    </>
  );
}

function GitBackupFormFields({ controller, connections, t, agentHandle }: GitBackupCardProps & { connections: string[] }) {
  const { form } = controller;
  const planning = controller.phase === "planning";
  return (
    <form className="jini-field-group" onSubmit={(event) => { event.preventDefault(); void controller.planBackup(); }}>
      <div className="jini-field-row">
        {connections.length > 1 ? (
          <div className="jini-field">
            <label className="jini-field-label" htmlFor="git-backup-connection">{t("Connection")}</label>
            <select id="git-backup-connection" value={form.connection} onChange={(event) => controller.setField({ field: "connection", value: event.target.value })} {...agentHandle({ handle: "import-export-git-backup-connection" }, { role: "field", label: "Git backup connection" })}>
              {connections.map((label) => <option key={label} value={label}>{label}</option>)}
            </select>
          </div>
        ) : null}
        <TextField agentHandle={agentHandle} id="git-backup-owner" label={t("Owner")} value={form.owner} onChange={(value) => controller.setField({ field: "owner", value: value })} />
        <TextField agentHandle={agentHandle} id="git-backup-repo" label={t("Repository")} value={form.repo} onChange={(value) => controller.setField({ field: "repo", value: value })} />
        <TextField agentHandle={agentHandle} id="git-backup-branch" label={t("Branch")} placeholder={t("Default branch")} value={form.branch} onChange={(value) => controller.setField({ field: "branch", value: value })} />
      </div>
      {/* `!`: this branch runs only when there is exactly one connection. */}
      {connections.length === 1 ? <p className="jini-field-hint">{interpolate({ template: t("Uses {connection}."), vars: { connection: connections[0]! } })}</p> : null}
      <div>
        <button type="submit" className="jini-btn-primary" disabled={!controller.canPlan} aria-busy={planning} {...agentHandle({ handle: "import-export-git-backup-plan" }, { role: "button", label: "Plan a Git backup of this site" })}>
          {planning ? t("Planning…") : t("Plan backup")}
        </button>
      </div>
    </form>
  );
}

function TextField({ id, label, value, placeholder, onChange, agentHandle }: { agentHandle: typeof AgentHandle; id: string; label: string; value: string; placeholder?: string; onChange: (value: string) => void }) {
  return (
    <div className="jini-field">
      <label className="jini-field-label" htmlFor={id}>{label}</label>
      <input id={id} type="text" autoComplete="off" spellCheck={false} maxLength={200} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} {...agentHandle({ handle: `import-export-${id}` }, { role: "field", label })} />
    </div>
  );
}

function PlanSummary({ controller, t, agentHandle }: GitBackupCardProps) {
  const plan = controller.plan;
  if (!plan) throw new Error("Git backup summary has no plan");
  const pushing = controller.phase === "pushing";
  return (
    <>
      <ul className="jini-import-export-git-backup-facts">
        <li><strong>{plan.repository}</strong> · {plan.branch}</li>
        <li>{interpolate({ template: t(plan.folderExists ? "Replaces folder {folder}." : "Creates folder {folder}."), vars: { folder: plan.folder } })}</li>
        <li>{interpolate({ template: t("{files} files, {size}"), vars: { files: String(plan.fileCount), size: plan.totalSize } })}</li>
        {plan.skipped.length > 0 ? <li>{interpolate({ template: t("{count} skipped"), vars: { count: String(plan.skipped.length) } })}</li> : null}
      </ul>
      {pushing && controller.progress ? (
        <p className="jini-field-hint" role="status">{interpolate({ template: t("Uploaded {done} of {total} files…"), vars: { done: String(controller.progress.filesDone), total: String(controller.progress.filesTotal) } })}</p>
      ) : null}
      <div className="jini-import-export-git-backup-actions">
        <button type="button" className="jini-btn-primary" disabled={pushing} aria-busy={pushing} onClick={() => void controller.pushBackup()} {...agentHandle({ handle: "import-export-git-backup-push" }, { role: "button", label: "Push the planned Git backup" })}>
          {pushing ? t("Pushing…") : t("Push backup")}
        </button>
        {pushing ? null : <button type="button" className="jini-btn-secondary" onClick={controller.reset} {...agentHandle({ handle: "import-export-git-backup-cancel" }, { role: "button", label: "Cancel the backup plan" })}>{t("Cancel")}</button>}
      </div>
    </>
  );
}

function BackupDone({ controller, t, agentHandle }: GitBackupCardProps) {
  const done = controller.done;
  if (!done) throw new Error("Git backup completion has no result");
  return (
    <>
      <p role="status">{interpolate({ template: t("Backed up to {repository}."), vars: { repository: done.repository } })}</p>
      <div className="jini-import-export-git-backup-actions">
        <a className="jini-btn-secondary" href={done.commitUrl} target="_blank" rel="noopener noreferrer" {...agentHandle({ handle: "import-export-git-backup-commit-link" }, { role: "link", label: "Open the backup commit on the Git host" })}>
          {t("View commit")}
        </a>
        <button type="button" className="jini-btn-secondary" onClick={controller.reset} {...agentHandle({ handle: "import-export-git-backup-again" }, { role: "button", label: "Plan another Git backup" })}>{t("Back up again")}</button>
      </div>
    </>
  );
}

function BackupRefused({ controller, t, agentHandle }: GitBackupCardProps) {
  return (
    <>
      <div className="jini-notice jini-notice-error" role="alert">{controller.message}</div>
      <div className="jini-import-export-git-backup-actions">
        <button type="button" className="jini-btn-secondary" onClick={controller.reset} {...agentHandle({ handle: "import-export-git-backup-retry" }, { role: "button", label: "Retry the Git backup" })}>{t("Try again")}</button>
      </div>
    </>
  );
}
