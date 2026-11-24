/**
 * @file Runtime parser for the daemon's retained-state RPC (wire types in
 * `@jini-ai/core/contracts/site/daemon-core-rpc`). The grammar is generic; the host injects the two
 * vocabularies that are its own policy — which consent keys a run may allow and which settings
 * namespaces `getEffective` may read — and keeps its private payloads (bootstrap snapshot, store
 * bindings) outside this module.
 */
import { z } from "zod/v3";
import type { DaemonCoreRequest, DaemonToolConsentSnapshot } from "@jini-ai/core/contracts/site/daemon-core-rpc";

const id = z.string().min(1).max(1024);
const runId = { runId: id };
const cliConsentTarget = { ...runId, agentId: id };

const operation = <N extends string, S extends z.ZodType>(name: N, input: S) => z.object({ operation: z.literal(name), input }).strict();
const primitiveAttributes = z.record(z.union([z.string(), z.number(), z.boolean()]));
// The wire grammar mirrors the trace event contract, never a provider implementation.
const captured = z.object({ chars: z.number(), text: z.string().optional(), truncated: z.boolean().optional(), redactions: z.record(z.number()).optional() }).nullable();
const nullableNumber = z.number().nullable();
const aiTraceEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run_started"), traceId: id, runId: id, at: z.number(), agentId: id, provider: z.string().nullable(), model: z.string().nullable(), sessionId: z.string().nullable(), input: captured, tags: z.array(z.string()) }),
  z.object({ kind: z.literal("model_turn"), traceId: id, turnId: id, index: z.number(), startedAt: z.number(), endedAt: z.number(), model: z.string().nullable(),
    input: captured, output: captured, reasoning: captured, usage: z.object({ inputTokens: nullableNumber, outputTokens: nullableNumber, cacheReadTokens: nullableNumber, cacheWriteTokens: nullableNumber, reasoningTokens: nullableNumber }).nullable(),
    costUsd: nullableNumber, costSource: z.enum(["provider", "estimated"]).nullable(), ttftMs: nullableNumber, stopReason: z.string().nullable(), error: z.string().nullable(),
    errorContent: captured.optional(), errorCode: z.string().nullable().optional(), toolCallCount: z.number().optional() }),
  z.object({ kind: z.literal("tool_call"), traceId: id, toolCallId: id, turnId: id, name: z.string(), input: captured, output: captured, isError: z.boolean(),
    errorClass: z.enum(["input_validation", "execution", "denied", "timeout"]).nullable(), startedAt: z.number(), endedAt: nullableNumber }),
  z.object({ kind: z.literal("run_finished"), traceId: id, at: z.number(), outcome: z.enum(["succeeded", "failed", "cancelled"]),
    error: z.object({ message: z.string(), code: z.string().nullable(), content: captured.optional() }).nullable(),
    totals: z.object({ turns: z.number(), toolCalls: z.number(), toolErrors: z.number(), inputTokens: nullableNumber, outputTokens: nullableNumber, costUsd: nullableNumber }) }),
]);

/** Explicit non-secret authority only; the daemon never receives the raw permissions blob. */
export const daemonToolConsentSnapshot: z.ZodType<DaemonToolConsentSnapshot, z.ZodTypeDef, unknown> = z.object({
  permissions: z.object({ enabled: z.boolean(), capabilities: z.record(z.boolean()) }).strict(),
  revisionSeq: z.number().int().nonnegative(), allowed: z.boolean(), reason: z.string().max(1024).optional(),
}).strict();

/** Build the request parser. `cliConsentKeys` is the complete set of keys `cliConsentAllow` may
 * name (its length also bounds the array); `settingsNamespaces` is the `getEffective` vocabulary. */
export function createDaemonCoreRequestSchema<Namespace extends string>(
  { cliConsentKeys, settingsNamespaces }: { cliConsentKeys: readonly string[]; settingsNamespaces: readonly [Namespace, ...Namespace[]] },
  _optional: Record<string, never> = {},
): z.ZodType<DaemonCoreRequest<Namespace>, z.ZodTypeDef, unknown> {
  // Two members cannot be proven by zod's inference, so they are the only widening here: a key typed
  // by a generic parameter is inferred optional, and the trace event's inferred shape differs from
  // the hand-written `AiTraceEvent` under `exactOptionalPropertyTypes`. Everything else is checked
  // against the wire type below, with `Namespace` as `string` and the trace input left open.
  const checked: z.ZodType<Exclude<DaemonCoreRequest, { operation: "telemetryTrace" }> | { operation: "telemetryTrace"; input: unknown }, z.ZodTypeDef, unknown> = buildRequestSchema({ cliConsentKeys, settingsNamespaces });
  return checked as z.ZodType<DaemonCoreRequest<Namespace>, z.ZodTypeDef, unknown>;
}

function buildRequestSchema({ cliConsentKeys, settingsNamespaces }: { cliConsentKeys: readonly string[]; settingsNamespaces: readonly string[] }) {
  const cliConsentKey = z.string().refine(key => cliConsentKeys.includes(key));
  const namespaceSchema = z.string().refine(value => settingsNamespaces.includes(value));
  return z.discriminatedUnion("operation", [
    operation("bootstrap", z.object({}).strict()),
    operation("cliConsentSnapshot", z.object(cliConsentTarget).strict()),
    operation("cliConsentAllow", z.object({ ...cliConsentTarget,
      keys: z.array(cliConsentKey).min(1).max(cliConsentKeys.length), expectedRevisionSeq: z.number().int().nonnegative(),
    }).strict()),
    operation("sessionForAttempt", z.object(runId).strict()),
    operation("find", z.object({ ...runId, principalId: id.optional() }).strict()),
    operation("captureSession", z.object({ ...runId, sessionId: id, confirmed: z.boolean().optional(),
      child: z.object({ pid: z.number().int().positive(), startedAt: id }).strict().optional() }).strict()),
    operation("clearSession", z.object({ ...runId, sessionId: id }).strict()),
    operation("guardTool", z.object({ ...runId, toolId: id, input: z.unknown(), toolUseId: id.optional() }).strict()),
    operation("completeTool", z.object({ ...runId, toolUseId: id, content: z.string() }).strict()),
    operation("getEffective", z.object({ namespace: namespaceSchema, key: id,
      scopeContext: z.object({ workspaceId: id, principalId: id.optional() }).strict() }).strict()),
    operation("telemetryCapture", z.object({ name: id, userId: id, properties: primitiveAttributes.optional() }).strict()),
    operation("telemetryError", z.object({ name: id, message: z.string(), stack: z.string().optional(),
      operation: id, attributes: z.record(z.union([z.string(), z.number()])).optional(), level: z.enum(["warning", "error"]).optional() }).strict()),
    operation("telemetryTrace", aiTraceEvent),
    operation("telemetryFlush", z.object({}).strict()),
  ]);
}
