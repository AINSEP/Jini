/**
 * @file Daemon-owned seam types shared with hosts: tool-access lowering, advisory tool guidance
 * and frontend-session ownership. Types only (XP4); the daemon keeps every value.
 */
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

/** One run attempt for one principal; the host alone decides whether it is still live. */
export type AgentPluginGuidanceAttempt = {
  readonly runId: string
  readonly attempt: number
  readonly principalId: string
}

/** Guidance drafted for one attempt. Offering records nothing; only a matching commit records delivery. */
export type AgentPluginGuidanceOffer = {
  readonly offerId: string
  readonly fullSections: readonly {
    readonly pluginId: string
    readonly text: string
  }[]
  /** Full sections, catalog rows for the remaining enabled plugins, then the off-plugin note. */
  readonly fullPrefix: string
  /** The same prefix with every full section replaced by its catalog row. */
  readonly catalogPrefix: string
}

/** Host-authenticated ownership, never derived from a model/run context blob. */
export interface FrontendSessionOwner {
  readonly workspaceId: string;
  readonly principalId: string;
  readonly tabId: string;
}
