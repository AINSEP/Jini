import type { Principal } from "../../principal.js";
import type { RunRef, SurfaceEmitter, ToolDescriptor } from "../../tool-registry.js";

/** Access removal stops the admitted answer; it cannot undo tools that already completed. */
export interface ToolAccessChange {
  readonly agentIds?: readonly string[];
  readonly serverIds?: readonly string[];
  readonly pluginIds?: readonly string[];
}

/** Advisory preparation after authorization/confirmation, before the handler. A failure is fail-open. */
export type PrepareToolGuidance = (required: { principal: Principal; run: RunRef; tool: ToolDescriptor; signal: AbortSignal; emitSurface?: SurfaceEmitter }, optional?: Record<string, never>) => Promise<string>;

/** Host-authenticated ownership, never derived from a model/run context blob. */
export interface FrontendSessionOwner {
  readonly workspaceId: string;
  readonly principalId: string;
  readonly tabId: string;
}
