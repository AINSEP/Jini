import { agentHandle } from "@jini-ai/core/agent-handles";

import type { AlwaysAllowController } from "./hooks/use-always-allow.hooks.js";

/**
 * @file The Integrations page's "Always allow" tab — markup only; state and API calls live in
 * `hooks/use-always-allow.hooks.ts`. The host mounts `always-allow.css` next to this panel.
 *
 * One heading + table per external MCP server with at least one tool set to "Always allow" on a chat approval
 * card, each tool with a Revoke button. Granting stays on the chat card (see the host's tool-approvals route header).
 */
export interface AlwaysAllowPanelProps {
  /** The host's wired hook (real port and locale); a test passes `useAlwaysAllow` over a fake port. */
  useAlwaysAllowHook: () => AlwaysAllowController;
}

export function AlwaysAllowPanel({ useAlwaysAllowHook }: AlwaysAllowPanelProps) {
  const { groups, loadError, revokeError, pendingKey, revoke, rowKey, formatDate, t } = useAlwaysAllowHook();

  if (loadError) return <div className="notice error">{loadError}</div>;
  if (!groups) return <div className="notice">{t("Loading…")}</div>;

  return (
    <div className="jini-always-allow-panel">
      <p className="page-description">{t("These tools run without asking. Revoke one and it asks again.")}</p>
      {revokeError ? <div className="notice error">{revokeError}</div> : null}
      {groups.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <p>{t("Nothing is set to Always allow. Pick it on a tool's approval card in chat.")}</p>
          </div>
        </div>
      ) : null}
      {groups.map((group) => (
        <section
          key={group.serverId}
          className="jini-always-allow-server"
          {...agentHandle({ handle: group.handle }, {
            role: "region",
            label: `Tools on the ${group.label} server set to Always allow`,
          })}
        >
          <h2 className="card-title">{group.label}</h2>
          <table className="list-table">
            <tbody>
              {group.tools.map((tool) => {
                const key = rowKey({ serverId: group.serverId, toolName: tool.toolName });
                return (
                  <tr key={key}>
                    <td>
                      <code>{tool.toolName}</code>
                    </td>
                    <td className="muted-cell">{formatDate({ grantedAt: tool.grantedAt })}</td>
                    <td className="jini-always-allow-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={pendingKey === key}
                        onClick={() => revoke({ serverId: group.serverId, toolName: tool.toolName })}
                        {...agentHandle({ handle: tool.revokeHandle }, {
                          role: "button",
                          label: `Revoke Always allow for ${tool.toolName} on ${group.label}; it will ask again`,
                        })}
                      >
                        {t("Revoke")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
