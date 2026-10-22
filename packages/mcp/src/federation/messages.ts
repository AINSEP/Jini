import type { ToolRefusalReason } from "./trust.js";
import type { FederatedCallConfirmationRequest } from "./ports.js";

/** Host-owned refusal wording; reason codes and sanitized data remain independent of presentation. */
export interface FederationRefusalMessages {
  readonly refusalExplanations: Readonly<Record<ToolRefusalReason, string>>;
  readonly unprintableName: string;
  readonly absentExplanation: string;
  readonly inertWriteGrantExplanation: string;
  readonly prefixHeading: string;
  readonly prefixInstruction: string;
  refusalBullet(required: { remoteName: string; connectionId: string; explanation: string }): string;
  omittedRefusals(required: { omitted: number; total: number }): string;
}

/** Shared federation presentation. Hosts replace the complete object, including confirmation and launch copy. */
export interface FederationMessages extends FederationRefusalMessages {
  authenticationRefused(required: { method: string; status: number }): string;
  readonly closedByHost: string;
  nativeCollision(required: { toolId: string }): string;
  /** Hosts can distinguish uvx/docker/general commands by basename (including Windows suffixes
   * and absolute paths), preserving remediation appropriate to their installed toolchain. */
  launchUnavailable(required: { command: string; searchedDirs: readonly string[] }): string;
  confirmationTitle(required: { request: FederatedCallConfirmationRequest }): string;
  confirmationWarning(required: { request: FederatedCallConfirmationRequest }): string;
  readonly confirmationDescription: string;
  readonly serviceLabel: string;
  readonly toolLabel: string;
  readonly argumentsLabel: string;
  readonly noArguments: string;
  readonly confirmLabel: string;
  readonly allowChatLabel: string;
  readonly allowAlwaysLabel: string;
}

/** Neutral English defaults are explicit host choices, never implicit branding or wire defaults. */
export const defaultFederationMessages: FederationMessages = {
  refusalExplanations: {
    "not-in-operator-allowlist": "the administrator has not allowed this tool for this connection. Fix: ask the administrator to allow this tool for this connection.",
    "remote-declares-not-read-only": "the server says this tool makes changes, but the connection has no write grant for it. Fix: ask the administrator to allow this tool and its changes for this connection.",
    "remote-declares-destructive": "the server marks this tool as destructive and the admission policy refused it. Fix: ask the administrator to review the connection's destructive-tool policy.",
    "missing-or-invalid-input-schema": "the server published no usable input schema, so arguments would be guesswork. Fix: ask the administrator to report the missing contract to the server vendor.",
    "invalid-remote-tool-name": "the server advertised a name that cannot be registered (letters, digits, '.', '-' or '_', at most 64 characters). Fix: ask the administrator to report the invalid name to the server vendor.",
    "duplicate-remote-tool-name": "the server advertised the same tool name twice; the repeat cannot overwrite the first definition. Fix: ask the administrator to report the duplicate to the server vendor.",
    "connection-tool-cap-reached": "the connection reached its maximum number of tools. Fix: ask the administrator to limit the connection to the tools that are needed, then restart the assistant.",
  },
  unprintableName: "(an invalid tool name sent by this server)",
  absentExplanation: "the administrator allowed this tool, but the server does not offer that name. Ask the administrator to check the name and the server's enabled features.",
  inertWriteGrantExplanation: "this tool has a write grant but no tool grant, so the write grant cannot take effect. Fix: ask the administrator to allow this tool for this connection.",
  prefixHeading: "EXTERNAL TOOL AVAILABILITY — read this before explaining a missing capability.",
  prefixInstruction: "These tools were withheld when the assistant started. They are absent from `search_tools` and `describe_tool` and cannot be called. Explain the listed reason and fix without inventing another cause. This snapshot stays fixed until the assistant restarts.",
  refusalBullet: ({ remoteName, connectionId, explanation }) => `- '${remoteName}' on external server '${connectionId}': ${explanation}`,
  omittedRefusals: ({ omitted, total }) => `- …and ${omitted} more, for ${total} withheld in total. Ask the administrator for the complete admission report.`,
  authenticationRefused: ({ method, status }) => `mcp-federation: the server refused '${method}' with ${status} — its authorization has expired or been revoked; ask the administrator to reconnect this connection`,
  closedByHost: "closed by the host",
  nativeCollision: ({ toolId }) => `mcp-federation: federated tool id '${toolId}' collides with a natively-registered tool — an external server must never be able to shadow the host's own catalog`,
  launchUnavailable: ({ command }) => `This server's command "${command}" is unavailable. Ask the administrator to install or configure the required executable.`,
  confirmationTitle: ({ request }) => `Run ${request.remoteName} on ${request.connectionLabel}?`,
  confirmationWarning: ({ request }) => {
    const base = request.destructive
      ? `${request.connectionLabel} marks this tool as destructive: it can delete or overwrite data, and that may not be undoable.`
      : `This can change things in ${request.connectionLabel}.`;
    return request.writeShapedInputs.length
      ? `${base} Its input ${request.writeShapedInputs.join(", ")} looks like it can change data, so the host asks every time.` : base;
  },
  confirmationDescription: "The assistant wants to run this with exactly the values below. Nothing runs until you allow it.",
  serviceLabel: "Service", toolLabel: "Tool", argumentsLabel: "Arguments", noArguments: "(none)",
  confirmLabel: "Allow", allowChatLabel: "Allow for this chat", allowAlwaysLabel: "Always allow",
};
