/**
 * @file The tool-gaps assistant tool's host dependencies and the gap read port. Types only.
 *
 * `ToolGapReadPort` is the read port shared by the owner HTTP surface and the assistant catalog
 * adapter; `ToolGapsToolDeps` is what the host injects into the owner-only `tool_gaps_list`
 * registration. The registration builder, its catalog and the repo adapter stay with the host.
 */
import type { ToolGapEntry } from "./daemon-tool-audit.js";

/** Read port shared by the owner HTTP surface and assistant catalog adapter. */
export interface ToolGapReadPort {
  list(required: { workspaceId: string; principalId: string }, optional?: { limit?: number }): Promise<readonly ToolGapEntry[]>;
}

export interface ToolGapsToolDeps {
  ownerPrincipalId: Promise<string>; workspaceId: string; toolGaps?: ToolGapReadPort;
}
