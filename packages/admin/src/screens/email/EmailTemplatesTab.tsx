import { ConfirmDialog } from "../../react/components/ConfirmDialog/ConfirmDialog.js";
import { DataTable } from "../../react/components/DataTable.js";
import { RowMenu } from "../../react/components/RowMenu/RowMenu.js";
import { agentHandle } from "@jini-ai/core/agent-handles";

import { adminHref, navigate } from "../../shell/lib/router.js";
import { t } from "./email-i18n.js";
import { Loaded, Section, when } from "./EmailParts.js";
import { templateEditorPath, type EmailTemplatesController } from "./hooks/use-email-templates.hooks.js";

/**
 * @file The Templates tab — a list like Pages (same `DataTable` + `RowMenu` + `ConfirmDialog`):
 * name (opens the editor page), subject, fill-in fields, updated; New, Rename, Move to trash.
 */

export function EmailTemplatesTab(props: { controller: EmailTemplatesController; locale: string }) {
  const { controller, locale } = props;
  const renaming = controller.renaming;
  return (
    <Section
      id="templates"
      title={t({ locale, key: "Templates" })}
      hideTitle
      actions={(
        <button type="button" onClick={() => void controller.create()} disabled={controller.creating}
          {...agentHandle({ handle: "email-templates-new" }, { role: "button", label: "Create a new email template" })}>
          {controller.creating ? t({ locale, key: "Creating…" }) : t({ locale, key: "New template" })}
        </button>
      )}
    >
      <p className="jini-field-hint">{t({ locale, key: "HTML emails with {{fields}} filled in when they send. You or the assistant can edit them." })}</p>
      {controller.error ? <div className="notice error" role="alert">{t({ locale, key: controller.error })}</div> : null}
      {renderEmailTemplatesTable({ controller, locale })}
      <ConfirmDialog
        open={renaming !== null}
        agentHandle="email-template-rename"
        title={t({ locale, key: "Rename template" })}
        body={(
          <div className="jini-field jini-admin-email-field">
            <label className="jini-field-label" htmlFor="email-template-rename">{t({ locale, key: "Name" })}</label>
            <input id="email-template-rename" className="jini-input" value={renaming?.name ?? ""} maxLength={200}
              onChange={(e) => controller.setRenameName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void controller.confirmRename(); } }}
              {...agentHandle({ handle: "email-template-rename-name" }, { role: "field", label: "New template name" })} />
          </div>
        )}
        confirmLabel={t({ locale, key: "Rename" })}
        pending={renaming?.pending ?? false}
        onConfirm={() => void controller.confirmRename()}
        onCancel={() => controller.startRename(null)}
      />
      <ConfirmDialog
        open={controller.pendingTrash !== null}
        agentHandle="email-template-trash"
        title={t({ locale, key: "Move to trash?" })}
        body={<p>{t({ locale, key: "\"{name}\" moves to Trash. You can restore it from there." }).replace("{name}", () => controller.pendingTrash?.name ?? "")}</p>}
        confirmLabel={t({ locale, key: "Move to trash" })}
        destructive
        pending={controller.trashing}
        onConfirm={() => void controller.confirmTrash()}
        onCancel={() => controller.setPendingTrash(null)}
      />
    </Section>
  );
}

function renderEmailTemplatesTable(
  { controller, locale }:
    Pick<Parameters<typeof EmailTemplatesTab>[0], "controller" | "locale">
) {
  return (
    <Loaded view={controller.view} locale={locale}>
      {({ templates }) => (
        <DataTable
          rows={templates}
          rowKey={(template) => template.id}
          empty={<p className="jini-field-hint">{t({ locale, key: "No templates yet." })}</p>}
          columns={[
            {
              key: "name",
              header: t({ locale, key: "Name" }),
              cell: (template) => (
                <a href={adminHref({ routePath: templateEditorPath({ id: template.id }) })} {...agentHandle({ handle: `email-template-${template.id}-edit` }, { role: "link", label: `Open the ${template.name} template` })}>
                  {template.name}
                </a>
              ),
            },
            { key: "subject", header: t({ locale, key: "Subject" }), cell: (template) => <span className="jini-admin-email-break">{template.subject}</span> },
            {
              key: "fields",
              header: t({ locale, key: "Fields" }),
              cell: (template) => (template.fields.length === 0 ? "—" : <code className="jini-admin-email-break">{template.fields.map((field) => `{{${field.name}}}`).join(" ")}</code>),
            },
            { key: "updated", header: t({ locale, key: "Updated" }), cell: (template) => when({ iso: template.updatedAt, locale }) },
            {
              key: "actions",
              header: t({ locale, key: "More" }),
              cell: (template) => (
                <RowMenu
                  triggerLabel={t({ locale, key: "Actions for \"{name}\"" }).replace("{name}", () => template.name)}
                  agentHandle={`email-template-${template.id}-menu`}
                  items={[
                    { key: "edit", label: t({ locale, key: "Edit" }), onSelect: () => navigate({ routePath: templateEditorPath({ id: template.id }) }) },
                    { key: "rename", label: t({ locale, key: "Rename" }), onSelect: () => controller.startRename(template) },
                    { key: "trash", label: t({ locale, key: "Move to trash" }), destructive: true, onSelect: () => controller.setPendingTrash(template) },
                  ]}
                />
              ),
            },
          ]}
        />
      )}
    </Loaded>
  );
}
