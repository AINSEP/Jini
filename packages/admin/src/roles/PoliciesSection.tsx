import { Fragment, type FormEvent } from "react";
import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import type { AdminPolicy } from "@jini-ai/core/contracts/site/user-management-react";
import { type PolicyRowController, type PolicyPermissionController, PolicyRow } from "./PolicyRow.js";


/** The create-a-policy form — {@link RoleCreateFormController} plus the description field. */
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
  t: (required: { key: string }, optional?: Record<string, never>) => string;
  locale: string;
}

/** "Policies" heading, create-policy form, and the policies table (or its empty state).
 *
 *  The row controllers pass straight through rather than being spread from an `Omit<PolicyRowProps,
 *  "policy">` rest object, which is what the old flat prop bag forced: with the props named, this
 *  section no longer has to restate the row's entire surface in its own type just to relay it. */
export function PoliciesSection({ policies, create, row, permission, t, locale }: PoliciesSectionProps) {
  // Policy ids are stable and unique, same reasoning as `RolesSection`'s `roleMenuHandles` above.
  const policyMenuBases = buildAgentListHandles({ prefix: "policies-row", ids: policies.map((policy) => policy.id) }
  );
  return (
    <>
      {/* Hidden for view, kept for assistive tech — see the matching note in `RolesSection`. */}
      <h2 className="jini-visually-hidden">{t({ key: "Policies" })}</h2>
      <form onSubmit={create.submit} className="jini-notice jini-roles-integrations-form jini-roles-form-measure">
        {create.error ? <span className="jini-save-error">{create.error}</span> : null}
        <label>
          {t({ key: "Policy name" })}
          <input
            value={create.name}
            onChange={(e) => create.setName(e.target.value)}
            required
            {...agentHandle({ handle: "policies-create-name" }, { role: "field", label: "New policy's name" })}
          />
        </label>
        <label>
          {t({ key: "Description (optional)" })}
          <input
            value={create.description}
            onChange={(e) => create.setDescription(e.target.value)}
            {...agentHandle({ handle: "policies-create-description" }, { role: "field", label: "New policy's optional description" })}
          />
        </label>
        <button
          type="submit"
          disabled={create.saving || !create.name}
          {...agentHandle({ handle: "policies-create-submit" }, { role: "button", label: "Create this new policy" })}
        >
          {create.saving ? t({ key: "Creating…" }) : t({ key: "Create policy" })}
        </button>
      </form>
      {policies.length === 0 ? (
        <div className="jini-card">
          <div className="jini-empty-state">
            <p>{t({ key: "No policies yet." })}</p>
          </div>
        </div>
      ) : (
        <div className="jini-roles-table-scroll">
          <table className="jini-roles-list-table">
            <thead>
              <tr>
                <th>{t({ key: "Name" })}</th>
                <th>{t({ key: "Description" })}</th>
                <th>{t({ key: "Type" })}</th>
                <th>{t({ key: "More" })}</th>
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
                    locale={locale}
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
