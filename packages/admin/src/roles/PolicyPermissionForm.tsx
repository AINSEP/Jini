import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import type { PolicyPermissionController } from "./PolicyRow.js";


interface PolicyPermissionFormProps {
  policyId: string;
  savingId: string | null;
  permission: PolicyPermissionController;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}

interface PolicyPermissionListProps {
  policyId: string;
  permission: PolicyPermissionController;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}

/** The open policy's current permissions, each with a Remove (OQ-10). A separate top-level
 *  function rather than a block inside `PolicyPermissionForm` for the same complexity-ceiling
 *  reason `PolicyRowActions` is one: its loading/empty/list three-way branch plus the per-row
 *  disabled ternary would otherwise all count in the form's own scope. */
function PolicyPermissionList({ policyId, permission, t }: PolicyPermissionListProps) {
  if (permission.loading) return <p className="jini-roles-muted-cell">{t({ key: "Loading permissions…" })}</p>;
  if (permission.rows.length === 0) return <p className="jini-roles-muted-cell">{t({ key: "No permissions yet." })}</p>;
  // Only the currently-open policy's own permission list is ever mounted at once, so a handle
  // needs to be unique within THIS list, not across every policy — same reasoning `Roles`' own
  // per-policy `agentBase` already applies one level up.
  const removeHandles = buildAgentListHandles({ prefix: `policy-permission-remove-${policyId}`, ids: permission.rows.map((row) => row.id) }
  );
  return (
    <ul className="jini-roles-permission-list">
      {permission.rows.map((row, index) => (
        <li key={row.id}>
          <code>{row.permission}</code>
          {row.resourceType ? <span className="jini-roles-muted-cell"> ({row.resourceType})</span> : null}
          <button
            type="button"
            disabled={permission.removingId === row.id}
            aria-label={`${t({ key: "Remove permission" })} ${row.permission}`}
            onClick={() => permission.requestRemove({ policyId, row })}
            {...agentHandle({ handle: removeHandles[index]! }, { role: "button", label: `Remove the "${row.permission}" permission from this policy` })}
          >
            {permission.removingId === row.id ? t({ key: "Removing…" }) : t({ key: "Remove" })}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The inline permission panel — the policy's current permissions (each removable) above the
 *  "Add permission" form. Extracted out of `PolicyRow` verbatim, for the same reason as
 *  `PolicyRowActions` above. */
export function PolicyPermissionForm({ policyId, savingId, permission, t }: PolicyPermissionFormProps) {
  // Only the currently-open policy's own form is ever mounted at once — same reasoning
  // `PolicyPermissionList`'s own `removeHandles` comment gives, one level up.
  const formHandleBase = buildAgentListHandles({ prefix: "policy-permission-form", ids: [policyId] })[0];
  return (
    <tr>
      <td colSpan={4}>
        <div className="jini-notice jini-roles-integrations-form">
          <p>{t({ key: "Current permissions" })}</p>
          <PolicyPermissionList policyId={policyId} permission={permission} t={t} />
          <label>
            {t({ key: "Permission" })}
            <span className="jini-editor-actions jini-roles-permission-form-fields">
              <input
                value={permission.permission}
                onChange={(e) => permission.setPermission(e.target.value)}
                placeholder={t({ key: "e.g. content.write" })}
                {...agentHandle({ handle: `${formHandleBase}-permission` }, { role: "field", label: "Permission string to grant, e.g. content.write" })}
              />
              <input
                value={permission.resourceType}
                onChange={(e) => permission.setResourceType(e.target.value)}
                placeholder={t({ key: "resource type (optional)" })}
                {...agentHandle({ handle: `${formHandleBase}-resource-type` }, { role: "field", label: "Optional resource type this permission is scoped to" })}
              />
              <button
                type="button"
                disabled={!permission.permission || savingId === policyId}
                onClick={() => permission.write({ policyId })}
                {...agentHandle({ handle: `${formHandleBase}-add` }, { role: "button", label: "Add this permission to the policy" })}
              >
                {savingId === policyId ? t({ key: "Saving…" }) : t({ key: "Add" })}
              </button>
            </span>
          </label>
        </div>
      </td>
    </tr>
  );
}
