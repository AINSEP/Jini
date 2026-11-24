/**
 * @file Wire shapes of the daemon's retained-state RPC: the request union a daemon-side process
 * sends to the host that owns the run ledger, settings and telemetry. Types only; the runtime
 * parser lives in `@jini-ai/daemon/core-rpc-schema` and the host injects its own consent keys and
 * settings namespaces there. The host keeps its snapshot and bootstrap payloads private.
 */
import type { AiTraceEvent } from "../ai-trace/index.js";

/** Explicit non-secret authority only; the daemon never receives the raw permissions blob. */
export interface DaemonToolConsentSnapshot {
  readonly permissions: { readonly enabled: boolean; readonly capabilities: Readonly<Record<string, boolean>> };
  readonly revisionSeq: number;
  readonly allowed: boolean;
  readonly reason?: string | undefined;
}
export interface DaemonCliConsentTarget { runId: string; agentId: string }
export interface DaemonCliConsentAllow extends DaemonCliConsentTarget { keys: readonly string[]; expectedRevisionSeq: number }

/** One operation per member; `operation` discriminates and `input` is validated per operation.
 * `Namespace` is the host's settings-namespace vocabulary for `getEffective`. */
export type DaemonCoreRequest<Namespace extends string = string> =
  | { operation: "bootstrap"; input: Record<string, never> }
  | { operation: "cliConsentSnapshot"; input: DaemonCliConsentTarget }
  | { operation: "cliConsentAllow"; input: DaemonCliConsentAllow }
  | { operation: "sessionForAttempt"; input: { runId: string } }
  | { operation: "find"; input: { runId: string; principalId?: string | undefined } }
  | { operation: "captureSession"; input: { runId: string; sessionId: string; confirmed?: boolean | undefined; child?: { pid: number; startedAt: string } | undefined } }
  | { operation: "clearSession"; input: { runId: string; sessionId: string } }
  | { operation: "guardTool"; input: { runId: string; toolId: string; input?: unknown | undefined; toolUseId?: string | undefined } }
  | { operation: "completeTool"; input: { runId: string; toolUseId: string; content: string } }
  | { operation: "getEffective"; input: { namespace: Namespace; key: string; scopeContext: { workspaceId: string; principalId?: string | undefined } } }
  | { operation: "telemetryCapture"; input: { name: string; userId: string; properties?: Record<string, string | number | boolean> | undefined } }
  | { operation: "telemetryError"; input: { name: string; message: string; stack?: string | undefined; operation: string; attributes?: Record<string, string | number> | undefined; level?: "warning" | "error" | undefined } }
  | { operation: "telemetryTrace"; input: AiTraceEvent }
  | { operation: "telemetryFlush"; input: Record<string, never> };
