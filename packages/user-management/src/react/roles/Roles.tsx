import { rolesDescriptionParts, roleDeleteBodyParts, policyDeleteBodyParts, permissionRemoveBodyParts } from "./text.js";
import type { Translate } from "@jini-ai/ui/panel-kit";
import { Fragment, type FormEvent } from "react";
import { DataTable, RowMenu, ConfirmDialog } from "@jini-ai/admin/react";
import { agentHandle } from "@jini-ai/agentic";
import type { AdminPolicy, AdminPolicyPermission, AdminRole } from "../models.js";
import { buildAgentListHandles } from "@jini-ai/ui/panel-kit";

import { TabBar } from "@jini-ai/ui/tab-strip";
import { roleMenuItems, policyMenuItems } from "./rules.js";
import { useRoles, type RolesDependencies, type PendingPermissionRemove } from "./hooks/use-roles.hooks.js";
import { resolveRolesTabId, resolveRolesTabs, type RolesTabId } from "./Roles.hooks.js";

export interface RolesProps extends RolesDependencies {
  onTabChange: (required: { tabId: RolesTabId }) => void;
  usersHref: string;

  tabId?: string | null | undefined;

  useRolesHook?: typeof useRoles | undefined;
}

type RolesController = ReturnType<typeof useRoles>;

export interface RoleCreateFormController {
  name: string;
  setName: (name: string) => void;
  saving: boolean;
  error: string | null;
  submit: (e: FormEvent) => Promise<void>;
}

export interface RoleRowController {

  editingId: string | null;
  setEditingId: (roleId: string | null) => void;
  draftName: string;
  setDraftName: (name: string) => void;
  startRename: (role: AdminRole) => void;
  saveRename: (required: { roleId: string }) => Promise<void>;

  savingId: string | null;
  requestDelete: (role: AdminRole | null) => void;
}

export interface RolesSectionProps {
  roles: AdminRole[];
  create: RoleCreateFormController;
  row: RoleRowController;
  t: (key: string) => string;
  translate: Translate;
}

export function RolesSection({ roles, create, row, t, translate }: RolesSectionProps) {

  const roleMenuHandles = buildAgentListHandles({ prefix: "roles-row", ids: roles.map((role) => role.id) });
  return (
    <>
      <h2 className="visually-hidden">{t("Roles")}</h2>
      <form onSubmit={create.submit} className="notice integrations-form form-measure">
        {create.error ? <span className="save-error">{create.error}</span> : null}
        <label>
          {t("Role name")}
          <input
            value={create.name}
            onChange={(e) => create.setName(e.target.value)}
            required
            {...agentHandle({ handle: "roles-create-name" }, { role: "field", label: t("New role's name") })}
          />
        </label>
        <button
          type="submit"
          disabled={create.saving || !create.name}
          {...agentHandle({ handle: "roles-create-submit" }, { role: "button", label: t("Create this new role") })}
        >
          {create.saving ? t("Creating…") : t("Create role")}
        </button>
      </form>
      <DataTable
        rows={roles}
        rowKey={(role) => role.id}
        empty={
          <div className="card">
            <div className="empty-state">
              <p>{t("No roles yet.")}</p>
            </div>
          </div>
        }
        columns={[
          {
            key: "name",
            header: t("Name"),
            cell: (role, index) =>
              row.editingId === role.id ? (
                <input
                  value={row.draftName}
                  onChange={(e) => row.setDraftName(e.target.value)}
                  {...agentHandle({ handle: `${roleMenuHandles[index]}-rename-name` }, { role: "field", label: t("This role's new name") })}
                />
              ) : (
                role.name
              ),
          },
          { key: "type", header: t("Type"), cell: (role) => (role.isBuiltin ? t("Built-in") : t("Custom")) },
          {
            key: "actions",
            header: t("More"),
            cell: (role, index) =>
              role.isBuiltin ? (
                <span className="muted-cell">—</span>
              ) : row.editingId === role.id ? (
                <span className="editor-actions">
                  <button
                    type="button"
                    disabled={row.savingId === role.id}
                    onClick={() => row.saveRename({ roleId: role.id })}
                    {...agentHandle({ handle: `${roleMenuHandles[index]}-save` }, { role: "button", label: t(`Save this role's new name`) })}
                  >
                    {row.savingId === role.id ? t("Saving…") : t("Save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => row.setEditingId(null)}
                    {...agentHandle({ handle: `${roleMenuHandles[index]}-cancel` }, { role: "button", label: t("Cancel renaming this role") })}
                  >
                    {t("Cancel")}
                  </button>
                </span>
              ) : (
                <RowMenu
                  triggerLabel={`${t("Actions for role")} "${role.name}"`}
                  agentHandle={`${roleMenuHandles[index]}-menu`}
                  items={roleMenuItems({ role, handlers: { onRename: row.startRename, onDelete: row.requestDelete }, translate })}
                />
              ),
          },
        ]}
      />
    </>
  );
}

export interface PolicyRowController {

  editingId: string | null;
  setEditingId: (policyId: string | null) => void;
  draftName: string;
  setDraftName: (name: string) => void;
  draftDescription: string;
  setDraftDescription: (description: string) => void;
  startRename: (policy: AdminPolicy) => void;
  saveRename: (required: { policyId: string }) => Promise<void>;
  savingId: string | null;
  requestDelete: (policy: AdminPolicy | null) => void;
}

export interface PolicyPermissionController {

  openForPolicyId: string | null;
  permission: string;
  setPermission: (permission: string) => void;
  resourceType: string;
  setResourceType: (resourceType: string) => void;
  toggleForm: (required: { policyId: string }) => void;
  write: (required: { policyId: string }) => Promise<void>;

  rows: AdminPolicyPermission[];
  loading: boolean;
  removingId: string | null;

  requestRemove: (target: PendingPermissionRemove) => void;
}

export interface PolicyRowProps {
  policy: AdminPolicy;
  row: PolicyRowController;
  permission: PolicyPermissionController;

  agentBase: string;
  t: (key: string) => string;
  translate: Translate;
}

interface PolicyRowActionsProps {
  policy: AdminPolicy;
  row: PolicyRowController;
  permission: PolicyPermissionController;
  agentBase: string;
  t: (key: string) => string;
  translate: Translate;
}

function PolicyRowActions({ policy, row, permission, agentBase, t, translate }: PolicyRowActionsProps) {
  if (policy.isBuiltin || policy.isFrozen) return <span className="muted-cell">—</span>;
  if (row.editingId === policy.id) {
    return (
      <span className="editor-actions">
        <button
          type="button"
          disabled={row.savingId === policy.id}
          onClick={() => row.saveRename({ policyId: policy.id })}
          {...agentHandle({ handle: `${agentBase}-save` }, { role: "button", label: t("Save this policy's new name and description") })}
        >
          {row.savingId === policy.id ? t("Saving…") : t("Save")}
        </button>
        <button
          type="button"
          onClick={() => row.setEditingId(null)}
          {...agentHandle({ handle: `${agentBase}-cancel` }, { role: "button", label: t("Cancel renaming this policy") })}
        >
          {t("Cancel")}
        </button>
      </span>
    );
  }
  return (
    <RowMenu
      triggerLabel={`${t("Actions for policy")} "${policy.name}"`}
      agentHandle={`${agentBase}-menu`}
      items={policyMenuItems({
        policy,
        permissionPolicyId: permission.openForPolicyId,
        handlers: {
          onRename: row.startRename,
          onTogglePermissionForm: permission.toggleForm,
          onDelete: row.requestDelete,
        },
        translate,
      })}
    />
  );
}

interface PolicyPermissionFormProps {
  policyId: string;
  savingId: string | null;
  permission: PolicyPermissionController;
  t: (key: string) => string;
}

interface PolicyPermissionListProps {
  policyId: string;
  permission: PolicyPermissionController;
  t: (key: string) => string;
}

function PolicyPermissionList({ policyId, permission, t }: PolicyPermissionListProps) {
  if (permission.loading) return <p className="muted-cell">{t("Loading permissions…")}</p>;
  if (permission.rows.length === 0) return <p className="muted-cell">{t("No permissions yet.")}</p>;

  const removeHandles = buildAgentListHandles({
    prefix: `policy-permission-remove-${policyId}`,
    ids: permission.rows.map((row) => row.id),
  });
  return (
    <ul className="permission-list">
      {permission.rows.map((row, index) => (
        <li key={row.id}>
          <code>{row.permission}</code>
          {row.resourceType ? <span className="muted-cell"> ({row.resourceType})</span> : null}
          <button
            type="button"
            disabled={permission.removingId === row.id}
            aria-label={`${t("Remove permission")} ${row.permission}`}
            onClick={() => permission.requestRemove({ policyId, row })}
            {...agentHandle({ handle: removeHandles[index]! }, { role: "button", label: t(`Remove the "${row.permission}" permission from this policy`) })}
          >
            {permission.removingId === row.id ? t("Removing…") : t("Remove")}
          </button>
        </li>
      ))}
    </ul>
  );
}

function PolicyPermissionForm({ policyId, savingId, permission, t }: PolicyPermissionFormProps) {

  const formHandleBase = buildAgentListHandles({ prefix: "policy-permission-form", ids: [policyId] })[0]!;
  return (
    <tr>
      <td colSpan={4}>
        <div className="notice integrations-form">
          <p>{t("Current permissions")}</p>
          <PolicyPermissionList policyId={policyId} permission={permission} t={t} />
          <label>
            {t("Permission")}
            <span className="editor-actions permission-form-fields">
              <input
                value={permission.permission}
                onChange={(e) => permission.setPermission(e.target.value)}
                placeholder={t("e.g. content.write")}
                {...agentHandle({ handle: `${formHandleBase}-permission` }, { role: "field", label: t("Permission string to grant, e.g. content.write") })}
              />
              <input
                value={permission.resourceType}
                onChange={(e) => permission.setResourceType(e.target.value)}
                placeholder={t("resource type (optional)")}
                {...agentHandle({ handle: `${formHandleBase}-resource-type` }, { role: "field", label: t("Optional resource type this permission is scoped to") })}
              />
              <button
                type="button"
                disabled={!permission.permission || savingId === policyId}
                onClick={() => permission.write({ policyId })}
                {...agentHandle({ handle: `${formHandleBase}-add` }, { role: "button", label: t("Add this permission to the policy") })}
              >
                {savingId === policyId ? t("Saving…") : t("Add")}
              </button>
            </span>
          </label>
        </div>
      </td>
    </tr>
  );
}

export function PolicyRow({ policy, row, permission, agentBase, t, translate }: PolicyRowProps) {
  const renaming = row.editingId === policy.id;
  return (
    <>
      <tr>
        <td>
          {renaming ? (
            <input
              value={row.draftName}
              onChange={(e) => row.setDraftName(e.target.value)}
              {...agentHandle({ handle: `${agentBase}-rename-name` }, { role: "field", label: t("This policy's new name") })}
            />
          ) : (
            policy.name
          )}
        </td>
        <td>
          {renaming ? (
            <input
              value={row.draftDescription}
              onChange={(e) => row.setDraftDescription(e.target.value)}
              {...agentHandle({ handle: `${agentBase}-rename-description` }, { role: "field", label: t("This policy's new description") })}
            />
          ) : (
            policy.description ?? <span className="muted-cell">—</span>
          )}
        </td>
        <td>
          {policy.isBuiltin ? t("Built-in") : t("Custom")}
          {policy.isFrozen ? ` ${t("(frozen)")}` : ""}
        </td>
        <td>
          <PolicyRowActions policy={policy} row={row} permission={permission} agentBase={agentBase} t={t} translate={translate} />
        </td>
      </tr>
      {permission.openForPolicyId === policy.id ? (
        <PolicyPermissionForm policyId={policy.id} savingId={row.savingId} permission={permission} t={t} />
      ) : null}
    </>
  );
}

export interface PolicyCreateFormController {
  name: string;
  setName: (name: string) => void;
  description: string;
  setDescription: (description: string) => void;
  saving: boolean;
  error: string | null;
  submit: (e: FormEvent) => Promise<void>;
}

export interface PoliciesSectionProps {
  policies: AdminPolicy[];
  create: PolicyCreateFormController;
  row: PolicyRowController;
  permission: PolicyPermissionController;
  t: (key: string) => string;
  translate: Translate;
}

export function PoliciesSection({ policies, create, row, permission, t, translate }: PoliciesSectionProps) {

  const policyMenuBases = buildAgentListHandles({ prefix: "policies-row", ids: policies.map((policy) => policy.id) });
  return (
    <>
      <h2 className="visually-hidden">{t("Policies")}</h2>
      <form onSubmit={create.submit} className="notice integrations-form form-measure">
        {create.error ? <span className="save-error">{create.error}</span> : null}
        <label>
          {t("Policy name")}
          <input
            value={create.name}
            onChange={(e) => create.setName(e.target.value)}
            required
            {...agentHandle({ handle: "policies-create-name" }, { role: "field", label: t("New policy's name") })}
          />
        </label>
        <label>
          {t("Description (optional)")}
          <input
            value={create.description}
            onChange={(e) => create.setDescription(e.target.value)}
            {...agentHandle({ handle: "policies-create-description" }, { role: "field", label: t("New policy's optional description") })}
          />
        </label>
        <button
          type="submit"
          disabled={create.saving || !create.name}
          {...agentHandle({ handle: "policies-create-submit" }, { role: "button", label: t("Create this new policy") })}
        >
          {create.saving ? t("Creating…") : t("Create policy")}
        </button>
      </form>
      {policies.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <p>{t("No policies yet.")}</p>
          </div>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="list-table">
            <thead>
              <tr>
                <th>{t("Name")}</th>
                <th>{t("Description")}</th>
                <th>{t("Type")}</th>
                <th>{t("More")}</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((policy, index) => (
                <Fragment key={policy.id}>
                  <PolicyRow
                    policy={policy}
                    row={row}
                    permission={permission}
                    agentBase={policyMenuBases[index]!}
                    t={t}
                    translate={translate}
                  />
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface RoleDeleteDialogProps {
  pendingRoleDelete: AdminRole | null;
  setPendingRoleDelete: (role: AdminRole | null) => void;
  rowSavingId: string | null;
  onDeleteRole: () => Promise<void>;
  t: (key: string) => string;
  translate: Translate;
}

function RoleDeleteDialog({ pendingRoleDelete, setPendingRoleDelete, rowSavingId, onDeleteRole, t, translate }: RoleDeleteDialogProps) {
  const { prefix, suffix } = roleDeleteBodyParts({ translate });
  return (
    <ConfirmDialog
      cancelLabel={t("Cancel")}
      open={pendingRoleDelete !== null}
      agentHandle="roles-delete-role"
      title={t("Delete role?")}
      body={
        pendingRoleDelete ? (
          <p>
            {prefix}
            {pendingRoleDelete.name}
            {suffix}
          </p>
        ) : null
      }
      confirmLabel={t("Delete")}
      destructive
      pending={pendingRoleDelete !== null && rowSavingId === pendingRoleDelete.id}
      onConfirm={onDeleteRole}
      onCancel={() => setPendingRoleDelete(null)}
    />
  );
}

interface PolicyDeleteDialogProps {
  pendingPolicyDelete: AdminPolicy | null;
  setPendingPolicyDelete: (policy: AdminPolicy | null) => void;
  rowSavingId: string | null;
  onDeletePolicy: () => Promise<void>;
  t: (key: string) => string;
  translate: Translate;
}

function PolicyDeleteDialog({ pendingPolicyDelete, setPendingPolicyDelete, rowSavingId, onDeletePolicy, t, translate }: PolicyDeleteDialogProps) {
  const { prefix, suffix } = policyDeleteBodyParts({ translate });
  return (
    <ConfirmDialog
      cancelLabel={t("Cancel")}
      open={pendingPolicyDelete !== null}
      agentHandle="roles-delete-policy"
      title={t("Delete policy?")}
      body={
        pendingPolicyDelete ? (
          <p>
            {prefix}
            {pendingPolicyDelete.name}
            {suffix}
          </p>
        ) : null
      }
      confirmLabel={t("Delete")}
      destructive
      pending={pendingPolicyDelete !== null && rowSavingId === pendingPolicyDelete.id}
      onConfirm={onDeletePolicy}
      onCancel={() => setPendingPolicyDelete(null)}
    />
  );
}

interface PermissionRemoveDialogProps {
  pendingPermissionRemove: PendingPermissionRemove | null;
  setPendingPermissionRemove: (target: PendingPermissionRemove | null) => void;
  removingPermissionId: string | null;
  onConfirmRemovePermission: () => Promise<void>;
  t: (key: string) => string;
  translate: Translate;
}

function PermissionRemoveDialog({
  pendingPermissionRemove,
  setPendingPermissionRemove,
  removingPermissionId,
  onConfirmRemovePermission,
  t,
  translate,
}: PermissionRemoveDialogProps) {
  const { prefix, suffix } = permissionRemoveBodyParts({ translate });
  const pending = pendingPermissionRemove;
  return (
    <ConfirmDialog
      cancelLabel={t("Cancel")}
      open={pending !== null}
      agentHandle="roles-remove-permission"
      title={t("Remove permission?")}
      body={
        pending ? (
          <p>
            {prefix}
            <code>{pending.row.permission}</code>
            {pending.row.resourceType ? ` (${pending.row.resourceType})` : ""}
            {suffix}
          </p>
        ) : null
      }
      confirmLabel={t("Remove")}
      tone="warning"
      pending={pending !== null && removingPermissionId === pending.row.id}
      onConfirm={onConfirmRemovePermission}
      onCancel={() => setPendingPermissionRemove(null)}
    />
  );
}

function RolesTab({ controller }: { controller: RolesController }) {
  const c = controller;
  return (
    <RolesSection
      roles={c.roles ?? []}
      create={{
        name: c.roleName,
        setName: c.setRoleName,
        saving: c.roleSaving,
        error: c.roleError,
        submit: c.onCreateRole,
      }}
      row={{
        editingId: c.editingRoleId,
        setEditingId: c.setEditingRoleId,
        draftName: c.editingRoleName,
        setDraftName: c.setEditingRoleName,
        startRename: c.startEditRole,
        saveRename: c.onSaveRole,
        savingId: c.rowSavingId,
        requestDelete: c.setPendingRoleDelete,
      }}
      t={c.t}
      translate={c.translate}
    />
  );
}

function PoliciesTab({ controller }: { controller: RolesController }) {
  const c = controller;
  return (
    <PoliciesSection
      policies={c.policies ?? []}
      create={{
        name: c.policyName,
        setName: c.setPolicyName,
        description: c.policyDescription,
        setDescription: c.setPolicyDescription,
        saving: c.policySaving,
        error: c.policyError,
        submit: c.onCreatePolicy,
      }}
      row={{
        editingId: c.editingPolicyId,
        setEditingId: c.setEditingPolicyId,
        draftName: c.editingPolicyName,
        setDraftName: c.setEditingPolicyName,
        draftDescription: c.editingPolicyDescription,
        setDraftDescription: c.setEditingPolicyDescription,
        startRename: c.startEditPolicy,
        saveRename: c.onSavePolicy,
        savingId: c.rowSavingId,
        requestDelete: c.setPendingPolicyDelete,
      }}
      permission={{
        openForPolicyId: c.permissionPolicyId,
        permission: c.permissionInput,
        setPermission: c.setPermissionInput,
        resourceType: c.resourceTypeInput,
        setResourceType: c.setResourceTypeInput,
        toggleForm: c.togglePermissionForm,
        write: c.onWritePermission,
        rows: c.permissionRows,
        loading: c.permissionsLoading,
        removingId: c.removingPermissionId,
        requestRemove: c.setPendingPermissionRemove,
      }}
      t={c.t}
      translate={c.translate}
    />
  );
}

function rolesTabPanel(activeTabId: RolesTabId, controller: RolesController) {
  if (activeTabId === "policies") return <PoliciesTab controller={controller} />;
  return <RolesTab controller={controller} />;
}

export function Roles({ tabId, useRolesHook = useRoles, port, translate: injectedTranslate, queryScope, onTabChange, usersHref }: RolesProps) {

  const controller = useRolesHook({ port, translate: injectedTranslate, queryScope });
  const {
    roles,
    policies,
    error,
    rowError,
    rowSavingId,
    pendingRoleDelete,
    setPendingRoleDelete,
    onDeleteRole,
    pendingPolicyDelete,
    setPendingPolicyDelete,
    onDeletePolicy,
    pendingPermissionRemove,
    setPendingPermissionRemove,
    removingPermissionId,
    onConfirmRemovePermission,
    t,
    translate,
  } = controller;
  const { prefix: descriptionPrefix, linkLabel: descriptionLinkLabel, suffix: descriptionSuffix } =
    rolesDescriptionParts({ translate });

  if (error) return <div className="notice error">{error}</div>;
  if (!roles || !policies) return <div className="notice">{t("Loading roles & permissions…")}</div>;

  const activeTabId = resolveRolesTabId({ tabId });

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{t("People")}</p>
          <h1 className="page-title">{t("Roles & Permissions")}</h1>
          <p className="page-description">
            {descriptionPrefix}
            <a href={usersHref}>{descriptionLinkLabel}</a>
            {descriptionSuffix}
          </p>
        </div>
      </div>
      {rowError ? <div className="notice error">{rowError}</div> : null}

      <TabBar
        ariaLabel={t("Roles & Permissions")}
        tabs={resolveRolesTabs({ translate: t })}
        activeId={activeTabId}
        onChange={(next: string) => onTabChange({ tabId: resolveRolesTabId({ tabId: next }) })}
        containerHandle="roles-tab-bar"
      />
      {rolesTabPanel(activeTabId, controller)}

      <RoleDeleteDialog
        pendingRoleDelete={pendingRoleDelete}
        setPendingRoleDelete={setPendingRoleDelete}
        rowSavingId={rowSavingId}
        t={t}
        translate={translate}
        onDeleteRole={onDeleteRole}
      />
      <PolicyDeleteDialog
        pendingPolicyDelete={pendingPolicyDelete}
        setPendingPolicyDelete={setPendingPolicyDelete}
        rowSavingId={rowSavingId}
        t={t}
        translate={translate}
        onDeletePolicy={onDeletePolicy}
      />
      <PermissionRemoveDialog
        pendingPermissionRemove={pendingPermissionRemove}
        setPendingPermissionRemove={setPendingPermissionRemove}
        removingPermissionId={removingPermissionId}
        onConfirmRemovePermission={onConfirmRemovePermission}
        t={t}
        translate={translate}
      />
    </div>
  );
}
