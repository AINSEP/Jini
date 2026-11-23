import { type FormEvent } from "react";
import { DataTable, RowMenu } from "../react/index.js";
import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import type { AdminRole } from "@jini-ai/core/contracts/site/user-management-react";
import { roleMenuItems } from "./rules.js";


/**
 * The create-a-role form, as one thing the section can be handed.
 *
 * Replaces the five loose `roleName`/`setRoleName`/`roleSaving`/`roleError`/`onCreateRole` props the
 * section used to take. They were never independent — every one of them is meaningless without the
 * other four — so naming the group is what lets a caller (or a test) supply a form rather than
 * assemble one out of parts.
 */
export interface RoleCreateFormController {
  name: string;
  setName: (name: string) => void;
  saving: boolean;
  error: string | null;
  submit: (e: FormEvent) => Promise<void>;
}

/** A role row's own affordances: rename in place, or ask for deletion. Grouped for the same reason
 *  as {@link RoleCreateFormController} — `editingId` and `draftName` describe one interaction. */
export interface RoleRowController {
  /** Which role is mid-rename, or `null`. */
  editingId: string | null;
  setEditingId: (roleId: string | null) => void;
  draftName: string;
  setDraftName: (name: string) => void;
  startRename: (role: AdminRole) => void;
  saveRename: (required: { roleId: string }, optional?: Record<string, never>) => Promise<void>;
  /** Which row has a write in flight — drives the per-row Saving… label, not a page-wide spinner. */
  savingId: string | null;
  requestDelete: (role: AdminRole | null) => void;
}

export interface RolesSectionProps {
  roles: AdminRole[];
  create: RoleCreateFormController;
  row: RoleRowController;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
  locale: string;
}

/** "Roles" heading, create-role form, and the roles `DataTable`.
 *  `DataTable`'s own `cell` callbacks are already separately-scoped closures under ESLint (each
 *  gets its own report), so this split is about the create-form's own branches, not the table.
 *
 *  Exported so a test can render it against hand-built controllers — the seam only counts as one if
 *  something other than `Roles` can drive it. */
export function RolesSection({ roles, create, row, t, locale }: RolesSectionProps) {
  // Role ids are stable and unique, so they disambiguate one row's menu from another's — same
  // reasoning as every other list on this workstream. Built-in rows render no `RowMenu` at all (see
  // the "actions" cell's own guard below), but a handle is still computed for every role so index
  // alignment with `roles` never drifts.
  const roleMenuHandles = buildAgentListHandles({ prefix: "roles-row", ids: roles.map((role) => role.id) }
  );
  return (
    <>
      {/* Kept in the DOM, hidden from view. Once this section sits behind a tab whose label is
          already the word "Roles", a visible `<h2>Roles</h2>` directly beneath it is pure visual
          repetition — but simply deleting it is not the fix, because `role="tab"` buttons do not
          appear in a screen reader's heading list, so the panel would be left with `H1` and nothing
          else (the regression `deployment/HistoryTab.tsx`'s own comment records measuring live).
          `.visually-hidden` keeps the structure for assistive tech and drops the duplicate from the
          page — the same utility `TabBar.tsx` itself uses for its dot label. `Seo.tsx`'s
          "Per-entry SEO" heading stays VISIBLE by the same rule: it is not a verbatim repeat of its
          tab ("Pages & posts"), so it still tells a sighted reader something. */}
      <h2 className="jini-visually-hidden">{t({ key: "Roles" })}</h2>
      <form onSubmit={create.submit} className="jini-notice jini-roles-integrations-form jini-roles-form-measure">
        {create.error ? <span className="jini-save-error">{create.error}</span> : null}
        <label>
          {t({ key: "Role name" })}
          <input
            value={create.name}
            onChange={(e) => create.setName(e.target.value)}
            required
            {...agentHandle({ handle: "roles-create-name" }, { role: "field", label: "New role's name" })}
          />
        </label>
        <button
          type="submit"
          disabled={create.saving || !create.name}
          {...agentHandle({ handle: "roles-create-submit" }, { role: "button", label: "Create this new role" })}
        >
          {create.saving ? t({ key: "Creating…" }) : t({ key: "Create role" })}
        </button>
      </form>
      {renderRolesTable({ roles, t, row, roleMenuHandles, locale })}
    </>
  );
}

function renderRolesTable(
  { roles, t, row, roleMenuHandles, locale }:
    Pick<RolesSectionProps, "roles" | "t" | "row" | "locale"> &
    { roleMenuHandles: ReturnType<typeof buildAgentListHandles> }
) {
  return (
    <DataTable
      rows={roles}
      rowKey={(role) => role.id}
      empty={
        <div className="jini-card">
          <div className="jini-empty-state">
            <p>{t({ key: "No roles yet." })}</p>
          </div>
        </div>
      }
      columns={[
        {
          key: "name",
          header: t({ key: "Name" }),
          cell: (role, index) =>
            renderRoleName({ row, role, roleMenuHandles, index }),
        },
        { key: "type", header: t({ key: "Type" }), cell: (role) => (role.isBuiltin ? t({ key: "Built-in" }) : t({ key: "Custom" })) },
        {
          key: "actions",
          header: t({ key: "More" }),
          cell: (role, index) => {
            if (role.isBuiltin) return <span className="jini-roles-muted-cell">—</span>;
            if (row.editingId === role.id) return renderRoleRenameActions({ row, role, roleMenuHandles, index, t });
            return (
              <RowMenu
                triggerLabel={`${t({ key: "Actions for role" })} "${role.name}"`}
                agentHandle={`${roleMenuHandles[index]}-menu`}
                items={roleMenuItems({ role, handlers: { onRename: row.startRename, onDelete: row.requestDelete }, locale })}
              />
            );
          },
        },
      ]}
    />
  );
}

function renderRoleName({ row, role, roleMenuHandles, index }: { row: Parameters<typeof renderRolesTable>[0]["row"]; role: Parameters<typeof RolesSection>[0]["roles"][number]; roleMenuHandles: Parameters<typeof renderRolesTable>[0]["roleMenuHandles"]; index: number }) {
  return (
    row.editingId === role.id ? (
      <input
        value={row.draftName}
        onChange={(e) => row.setDraftName(e.target.value)}
        {...agentHandle({ handle: `${roleMenuHandles[index]}-rename-name` }, { role: "field", label: "This role's new name" })}
      />
    ) : (
      role.name
    )
  );
}

function renderRoleRenameActions(
  { row, role, roleMenuHandles, index, t }:
    Pick<Parameters<typeof renderRolesTable>[0], "row" | "roleMenuHandles" | "t"> &
    { role: RolesSectionProps["roles"][number]; index: number }
) {
  return (
    <span className="jini-editor-actions">
      <button
        type="button"
        disabled={row.savingId === role.id}
        onClick={() => row.saveRename({ roleId: role.id })}
        {...agentHandle({ handle: `${roleMenuHandles[index]}-save` }, { role: "button", label: `Save this role's new name` })}
      >
        {row.savingId === role.id ? t({ key: "Saving…" }) : t({ key: "Save" })}
      </button>
      <button
        type="button"
        onClick={() => row.setEditingId(null)}
        {...agentHandle({ handle: `${roleMenuHandles[index]}-cancel` }, { role: "button", label: "Cancel renaming this role" })}
      >
        {t({ key: "Cancel" })}
      </button>
    </span>
  );
}
