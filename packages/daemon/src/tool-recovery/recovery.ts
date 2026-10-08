
import type { Principal, ToolDescriptor, ToolRegistry } from "@jini-ai/core";
import type { ToolExecutionResult, ToolExecutor } from "../tool-executor.js";


import { isIssuedToolFailureDiagnostic, type ToolFailureDiagnostic } from "./diagnostics.js";
import {
  askOnce,
  SURFACE_DISMISSED_PARAM,
  SURFACE_EXCHANGE_ID_PARAM,
  type SurfaceExchange,
  type SurfaceExchangeStore,
} from "../surface-exchanges.js";
import { refuseNonReadOnlyDispatch, type ReadOnlyToolMessages } from "../core/read-only-tools.js";

/**
 * @file The CONSUMER of `contracts/core/tool-failure-diagnostics.ts`'s `ToolFailureDiagnostic`
 * contract — the generic ask -> apply -> retry-once loop that contract's own header describes as the
 * payoff for adopting it ("one generic loop ... can handle a failure mode nobody wrote code for, using
 * the identical mechanism that already handles one somebody did"). Before this file, `hint`/
 * `remedyToolId` were read by nobody but the MODEL, acting on prose in a tool's own catalog
 * description (`custom_credential_verify`/`custom_credential_make_request`'s "ask the human ...
 * retry ONCE" wording). This file makes the same recovery a real mechanism that runs whether or not
 * the model happens to follow that prose.
 *
 * ## The seam: a `ToolExecutor` decorator, not a tool
 *
 * `withToolFailureRecovery` wraps `@jini-ai/daemon`'s `ToolExecutor` — the SAME kind of drop-in
 * `tool-executor-audit.ts`'s `withToolAttemptAudit` already is, for the same reason: this is the one
 * layer that (a) sees every completed tool result BEFORE it reaches the model, (b) is handed the
 * live `emitSurface` a handler would use to raise a human-facing surface, and (c) can re-invoke a
 * tool — the remedy, then the original again — with the SAME `principal`/`run`/`signal` the first
 * call had. No domain module (a `tool-registrations.ts`) has all three: a domain handler sees only
 * its OWN result, not another domain's `remedyToolId`. The tool-registration layer was considered and
 * rejected for exactly that reason — `custom_credential_set_username` is a different domain from
 * whatever OTHER tool a future diagnostic might name, and this loop has to work for a diagnostic
 * nobody has written yet, not just this one.
 *
 * Composed OUTSIDE `withToolAttemptAudit` in `agent-daemon-server.ts` (audit wraps the bare executor;
 * this wraps the audited one) so the remedy call and the retry are each their own audited attempt,
 * not lost inside one outer "completed" row — see that file's own wiring comment.
 *
 * ## What triggers it
 *
 * Only a `status: 'completed'` execution (a handler that returned normally) is even inspected — a
 * thrown error has no structured output to carry a diagnostic in, and `ToolFailureDiagnostic` was
 * never meant to model that case (see that file's own header, facet 1). The completed output is
 * walked (bounded, see {@link findActionableDiagnostic}) for the first plain object the tool ISSUED
 * (`issueToolFailureDiagnostic` — so stored content shaped like a diagnostic never counts) carrying BOTH a
 * string `hint` AND a string `remedyToolId`. `hint` with no `remedyToolId` is deliberately NOT
 * actionable here — the general contract's own header says as much ("no registered tool can supply
 * the fix yet ... still worth surfacing to a human who can act on it by hand"): a human reading the
 * model's own report of the failure is that "by hand" path; this loop only exists for the case where
 * a tool id names something IT can do about it.
 *
 * ## What it asks for, and why that can never be a secret
 *
 * The loop does not know what a `hint` means — it is prose. What it CAN know, structurally, is the
 * remedy tool's own published {@link ToolDescriptor.inputSchema}: which fields it requires, and which
 * of those the ORIGINAL failing call's input already supplies (by matching key name — e.g. both
 * `custom_credential_make_request` and `custom_credential_set_username` name a `label`). Whatever is
 * required but not already known is the ONE thing worth asking a human for — see
 * {@link planRemedyCall}. This is deliberately narrow: more than one unknown field, or a field whose
 * schema type isn't plain text, means this loop has no safe, generic way to ask for it, and it backs
 * off entirely rather than invent a shape.
 *
 * That narrowness is what keeps a secret out of this loop's own text field, BY CONSTRUCTION, not by a
 * rule someone has to remember: `custom_credential_set_token`'s entire schema is `{label}`, and
 * `label` is already known from the original call — so `planRemedyCall` computes ZERO fields to ask
 * for, and this loop calls it with nothing but the carried-forward `label`. The token itself, if that
 * tool is ever named as a `remedyToolId`, would still only ever reach the server the way that tool's
 * OWN handler already collects it (its own masked form, opened when THIS loop invokes it) — never
 * through a field this loop rendered, and never through a model-issued call's params. See
 * `credentialed-request.ts`'s header for the incident this reasoning was written against.
 *
 * ## The one-cycle guard — structural, not a counter
 *
 * `execute` below calls `inner.execute` up to three times (the original call, the remedy call, the
 * retry) and NEVER calls itself or the wrapper it returns. There is therefore no code path by which a
 * hint surfacing on the remedy call's own result, or on the retry's result, can trigger a second ask
 * -> apply -> retry cycle: the scan-for-a-diagnostic step only ever runs once per external
 * `execute()` invocation, because it is written exactly once, outside any loop or recursion. A future
 * edit would have to ADD a call from inside this function back into itself to reintroduce a second
 * cycle — it cannot happen by a counter being reset, a flag being missed, or any other stateful
 * mistake, because no state is involved at all.
 *
 * ## What it never does
 *
 * - Never suppresses the original failure: every early return hands back `result` — the exact object
 *   `inner.execute` produced for the original call, provider body and status included — untouched.
 *   The one return that is not byte-identical still carries that exact `output`: a remedy refused
 *   because this execution is read-only-constrained adds an `error` explaining that the recovery was
 *   not attempted (see `read-only-tool-constraint.ts`), because returning the original silently would
 *   be its own lie — "nothing was written" and "nothing was ever going to be tried" are different
 *   facts, and the caller can only act on the second one if it is told.
 * - Never runs a remedy that writes on behalf of a caller that asked for reads only. The dispatch
 *   below would be refused by `withReadOnlyToolConstraint` in any case — that gate is the
 *   enforcement, and it sits innermost precisely so it does not depend on this file remembering —
 *   but this loop asks the same single question first so no human is ever prompted for an answer
 *   that would then be thrown away.
 * - Never invents an answer: a declined, dismissed, expired, or blank response to the recovery surface
 *   is treated as "do not proceed," not as licence to guess.
 * - Never adds cost to the overwhelmingly common no-hint case: the scan is one bounded, pure walk of
 *   an already-in-memory value, no I/O, no surface, no second call.
 *
 * Architectural role: `src/assistant` composition-layer adapter, mirroring `tool-executor-audit.ts`'s
 * own role — depends on the domain-agnostic surface-exchange contract and the kernel's own
 * `ToolExecutor`/`ToolRegistry` shapes, never on any domain feature.
 */

/** Bounds {@link findActionableDiagnostic}'s walk of a handler's output — generous for any real tool
 *  result in this codebase (a handful of fields, one or two levels of nesting) while keeping an
 *  adversarially large or deep result cheap to give up on rather than a source of unbounded work. */
const MAX_DIAGNOSTIC_SCAN_DEPTH = 6;
const MAX_DIAGNOSTIC_SCAN_NODES = 500;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The one shape this loop treats as actionable — both fields present, both non-empty strings. `hint`
 *  alone (no `remedyToolId`) is deliberately excluded; see this file's header. */
type ActionableToolFailureDiagnostic = Required<Pick<ToolFailureDiagnostic, "hint" | "remedyToolId">> & Pick<ToolFailureDiagnostic, "setupToolId" | "prefill">;

function isActionableDiagnostic(value: Record<string, unknown>): value is ActionableToolFailureDiagnostic {
  return typeof value.hint === "string" && value.hint.length > 0 && typeof value.remedyToolId === "string" && value.remedyToolId.length > 0;
}

/**
 * Whether a remedy tool's own COMPLETED result reports that it did not actually apply the fix. A
 * `completed` execution status means only that the remedy tool ran without being denied or throwing —
 * several human-gated write tools in this codebase report a decline, an expiry, or a validation
 * failure as a normal `{saved: false, reason, ...}` RESULT rather than a non-completed status (see
 * `custom_credential_set_token`, `external_mcp_*_save`, and the S3-compatible publish-credential save,
 * each returning `{saved: true}` on success or `{saved: false, ...}` for every other outcome). This
 * loop must not read `completed` as `succeeded` for any of them, or it would retry the original call
 * as if the fix had been applied when it had not.
 *
 * @complexity O(1).
 */
function remedyReportedFailure(output: unknown): boolean {
  return isPlainObject(output) && (output["saved"] === false || output["created"] === false || output["cancelled"] === true || output["connected"] === false);
}

/** Mutable, explicitly-threaded scan budget for {@link walkForDiagnostic} — a plain object passed down
 *  the recursion rather than a closed-over variable, so the counter is an explicit dependency of the
 *  function that mutates it instead of implicit shared state (see `coding-foundations`). */
interface DiagnosticScanState {
  visited: number;
}

/** `true` once the bounded walk should stop descending — depth past {@link MAX_DIAGNOSTIC_SCAN_DEPTH}
 *  or the node budget exhausted. Pulled out of {@link walkForDiagnostic} so that function's own guard
 *  is a single call instead of a compound `||` condition. */
function diagnosticScanLimitReached(depth: number, scanState: DiagnosticScanState): boolean {
  return depth > MAX_DIAGNOSTIC_SCAN_DEPTH || scanState.visited >= MAX_DIAGNOSTIC_SCAN_NODES;
}

/** The children {@link walkForDiagnostic} should recurse into for `value` — an object's own values, an
 *  array's own elements, or `undefined` for anything else (a leaf, nothing to descend into). */
function diagnosticScanChildren(value: unknown): Iterable<unknown> | undefined {
  if (isPlainObject(value)) return Object.values(value);
  if (Array.isArray(value)) return value;
  return undefined;
}

/**
 * One step of the bounded walk for {@link findActionableDiagnostic} — checks `value` itself, then
 * recurses into its children (via {@link diagnosticScanChildren}) until a match is found or the walk
 * is exhausted.
 *
 * @complexity O(min(n, {@link MAX_DIAGNOSTIC_SCAN_NODES})) where n is the subtree's own node count.
 */
function walkForDiagnostic(value: unknown, depth: number, scanState: DiagnosticScanState): ActionableToolFailureDiagnostic | undefined {
  if (diagnosticScanLimitReached(depth, scanState)) return undefined;
  scanState.visited += 1;

  // Issued, not merely shaped like one: stored content a tool returns (a post's `bodyJson`, a
  // widget's props) is plain JSON and can carry `{hint, remedyToolId}` too. Only a diagnostic the
  // tool itself issued for a failure may raise the recovery dialog — see `issueToolFailureDiagnostic`.
  if (isPlainObject(value) && isIssuedToolFailureDiagnostic({ value }, {}) && isActionableDiagnostic(value)) {
    return value;
  }

  const children = diagnosticScanChildren(value);
  if (!children) return undefined;
  for (const child of children) {
    const found = walkForDiagnostic(child, depth + 1, scanState);
    if (found) return found;
  }
  return undefined;
}

/**
 * Walks a completed tool call's raw output for the first nested object carrying an actionable
 * diagnostic (see {@link isActionableDiagnostic}) — domain-agnostic by construction: it knows nothing
 * about `authDiagnostic`, credentials, or any other field name a concrete diagnostic type happens to
 * nest itself under, only the two-field SHAPE the general contract defines.
 *
 * @param output - `ToolExecutionResult.output` from a `'completed'` execution.
 * @returns The diagnostic, or `undefined` if none is found within the bounded walk.
 * @complexity O(min(n, {@link MAX_DIAGNOSTIC_SCAN_NODES})) where n is the output's own node count.
 */
function findActionableDiagnostic(output: unknown): ActionableToolFailureDiagnostic | undefined {
  return walkForDiagnostic(output, 0, { visited: 0 });
}

type JsonPrimitive = string | number | boolean | null;

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** What this loop has worked out it can safely do about one diagnostic — see {@link planRemedyCall}. */
interface RemedyPlan {
  readonly remedyToolId: string;
  /** Required fields the remedy tool's own schema names that the ORIGINAL call's input already
   *  supplies, carried forward verbatim so the human is never asked to repeat something already
   *  known (e.g. the credential's `label`). Restricted to JSON primitives — see {@link planRemedyCall}. */
  readonly carryForward: Readonly<Record<string, JsonPrimitive>>;
  /** The ONE remaining required field to ask a human for, when the remedy tool needs one the original
   *  call did not supply. Absent when every required field is already known (e.g.
   *  `custom_credential_set_token`'s `{label}`-only schema) — see this file's header for why that
   *  case is exactly what keeps a secret out of this loop's own form. */
  readonly askFor?: { readonly key: string; readonly prompt: string };
}

/** The remedy tool's own required-field list and property schemas, pulled out of its `inputSchema` —
 *  or `undefined` if the tool isn't registered or its schema isn't object-shaped at all. Split out of
 *  {@link planRemedyCall} so that function's own guard clauses read as one step per concern. */
function resolveRemedySchemaShape(descriptor: ToolDescriptor | undefined): { required: readonly string[]; properties: Record<string, unknown> } | undefined {
  if (!descriptor || !isPlainObject(descriptor.inputSchema)) return undefined;
  const schema = descriptor.inputSchema;
  const required = Array.isArray(schema["required"]) ? (schema["required"] as unknown[]).filter((k): k is string => typeof k === "string") : [];
  const properties = isPlainObject(schema["properties"]) ? schema["properties"] : {};
  return { required, properties };
}

/** Which single required field (if any) the original call did not already supply — or the "too many
 *  unknowns" outcome. See {@link planRemedyCall}'s own doc for why more than one unknown field means
 *  this loop backs off entirely rather than build a multi-field form. */
type AskKeyResolution = { readonly ok: true; readonly askKey: string | undefined } | { readonly ok: false };

function resolveAskKey(required: readonly string[], knownInput: Record<string, unknown>): AskKeyResolution {
  const missing = required.filter((key) => !(key in knownInput));
  if (missing.length > 1) return { ok: false };
  return { ok: true, askKey: missing[0] };
}

/** Every required field except `askKey`, carried forward verbatim from `knownInput` — or `undefined`
 *  if one of them isn't a JSON primitive (nothing safe to re-forward without guessing at its shape). */
function buildCarryForward(input: { required: readonly string[]; askKey: string | undefined; knownInput: Record<string, unknown> }): Readonly<Record<string, JsonPrimitive>> | undefined {
  const { required, askKey, knownInput } = input;
  const carryForward: Record<string, JsonPrimitive> = {};
  for (const key of required) {
    if (key === askKey) continue;
    const value = knownInput[key];
    if (!isJsonPrimitive(value)) return undefined;
    carryForward[key] = value;
  }
  return carryForward;
}

function isTextLikeSchemaType(type: unknown): boolean {
  return type === "string" || (Array.isArray(type) && type.every((t) => t === "string" || t === "null"));
}

/** Builds the one field this loop asks a human for, from `askKey`'s own schema entry — or `undefined`
 *  if that schema isn't plain-text-shaped (this loop never invents how to render a number, boolean,
 *  enum, or nested-object field). */
function resolveAskFor(input: { askKey: string; properties: Record<string, unknown> }): RemedyPlan["askFor"] | undefined {
  const { askKey, properties } = input;
  const propSchema = properties[askKey];
  if (!isPlainObject(propSchema) || !isTextLikeSchemaType(propSchema["type"])) return undefined;

  const description = propSchema["description"];
  const prompt = typeof description === "string" && description.trim() !== "" ? description : askKey;
  return { key: askKey, prompt };
}

/**
 * Works out whether — and how — this loop can safely build a call to `remedyToolId`, from nothing but
 * that tool's own published `inputSchema` and the ORIGINAL failing call's input. Returns `undefined`
 * whenever the shape does not fit the one pattern this loop knows how to act on safely: this is the
 * function that decides "not cleanly possible" for one diagnostic, without ever guessing past it.
 *
 * @param input.descriptor - The remedy tool's registry descriptor, or `undefined` if `remedyToolId`
 *   is not actually registered (a diagnostic naming a tool that does not exist).
 * @param input.originalInput - The input the ORIGINAL (failing) call was made with.
 * @returns `undefined` if: the remedy tool isn't registered or has no object-shaped `inputSchema`;
 *   more than one of its required fields is unknown (no single honest question covers all of them);
 *   a required field already known is not a JSON primitive (nothing to safely re-forward); or the one
 *   unknown field's own schema type is not plain-text-shaped (this loop never invents how to render an
 *   unfamiliar field kind).
 * @complexity O(k) in the remedy schema's own required-field count (small, fixed per tool).
 */
function planRemedyCall(input: { remedyToolId: string; descriptor: ToolDescriptor | undefined; originalInput: unknown }): RemedyPlan | undefined {
  const { remedyToolId, descriptor, originalInput } = input;
  const shape = resolveRemedySchemaShape(descriptor);
  if (!shape) return undefined;

  const knownInput = isPlainObject(originalInput) ? originalInput : {};
  const missingField = resolveAskKey(shape.required, knownInput);
  if (!missingField.ok) return undefined;

  const carryForward = buildCarryForward({ required: shape.required, askKey: missingField.askKey, knownInput });
  if (!carryForward) return undefined;
  if (missingField.askKey === undefined) return { remedyToolId, carryForward };

  const askFor = resolveAskFor({ askKey: missingField.askKey, properties: shape.properties });
  if (!askFor) return undefined;

  return { remedyToolId, carryForward, askFor };
}

/** Card schemas accept metadata only. Reject secret-shaped prefills before even asking. */
function planCredentialSetup(
  { diagnostic, descriptor, deps }: { diagnostic: ActionableToolFailureDiagnostic; descriptor: ToolDescriptor | undefined; deps: ToolFailureRecoveryDeps }, _optional = {},
): RemedyPlan | undefined {
  const shape = resolveRemedySchemaShape(descriptor);
  if (!shape || diagnostic.setupToolId !== diagnostic.remedyToolId || !diagnostic.prefill) return undefined;
  const prefill = diagnostic.prefill;
  for (const [key, value] of Object.entries(prefill)) {
    if (!(key in shape.properties) || /token|secret|password|authorization|env|headers|body|key/i.test(key)) return undefined;
    if (!isJsonPrimitive(value) || (typeof value === "string" && deps.containsSecret({ text: value }))) return undefined;
    if (typeof value === "string") {
      try { deps.assertCredentialFreeField({ value, field: key }, {}); } catch { return undefined; }
    }
  }
  if (shape.required.some(key => !(key in prefill))) return undefined;
  return { remedyToolId: diagnostic.remedyToolId, carryForward: prefill };
}

/** What the human decided, or the fact that nothing usable came back — never a guess in either
 *  direction. `answerValue` is present only when `askFor` was set AND the submission was non-blank;
 *  see this function's own blank-answer branch for why that is treated as "skip," not "guess." */
type RecoveryDecision = { readonly proceed: false } | { readonly proceed: true; readonly answerValue?: string };

/**
 * Sends the recovery surface and waits for the human's answer — plain `askOnce`, matching
 * `custom_credential_make_request`'s own DELETE-gate precedent (`resolveMakeRequestDeleteDecision`)
 * rather than `askThenReport`: this loop's surface is an ask ABOUT what to try next, not a rendering
 * of a secret's own submission state, so there is nothing here `askThenReport` was built to correct.
 *
 * @complexity O(1) plus whatever `askOnce` itself costs.
 */
async function resolveRecoveryDecision(exchange: SurfaceExchange, ui: unknown, askForKey: string | undefined): Promise<RecoveryDecision> {
  const answer = await askOnce({ exchange, emission: { channel: "mcp-ui", payload: { resource: ui } } });
  if (answer.status !== "received") return { proceed: false };
  if (answer.params[SURFACE_DISMISSED_PARAM] === true) return { proceed: false };
  if (askForKey === undefined) return { proceed: true };

  const raw = answer.params[askForKey];
  const answerValue = typeof raw === "string" ? raw.trim() : "";
  // Never invent an answer: a blank submission is treated as "do not proceed," not as a value to try.
  if (answerValue === "") return { proceed: false };
  return { proceed: true, answerValue };
}

export interface ToolFailureRecoveryDeps {
  /** The SAME instance `agent-daemon-server.ts` mounts `registerMcpUiToolCallsRoute` with — a
   *  different one would leave this loop's own recovery surface unreachable, exactly the failure mode
   *  `@jini-ai/daemon/surface-exchanges`'s own `AssistantSurfaceDeps` doc warns about for every other
   *  consumer of this store. */
  readonly surfaceExchanges: SurfaceExchangeStore;
  /** Read-only: this loop only ever calls {@link ToolRegistry.list} to look up a remedy tool's own
   *  published `inputSchema` — never a handler, and never anything requiring authorization to read. */
  readonly registry: Pick<ToolRegistry, "list">;
  readonly recoveryToolId: string;
  readonly containsSecret: (required: { text: string }) => boolean;
  readonly assertCredentialFreeField: (required: { value: string; field: string }, optional: Record<string, never>) => void;
  readonly readOnlyMessages: ReadOnlyToolMessages;
  readonly formatReadOnlyRemedyRefusal: (required: { refusal: string }) => string;
  /** Rendering is host-owned: daemon cannot depend on browser/UI packages. */
  readonly buildRecoveryForm: (required: { exchangeId: string; hint: string; remedyToolId: string; askFor?: { key: string; prompt: string } }, optional?: Record<string, never>) => unknown;
}

/** Whether `execute` should even attempt recovery, and what it found — pulled out of `execute` itself
 *  so its own guard clauses (read-only refusal, no plannable remedy) don't count toward that method's
 *  complexity. `attempt: false` always carries the exact `ToolExecutionResult` `execute` must return:
 *  the original result untouched, except for the one case (a read-only refusal) that must say why
 *  recovery was not attempted rather than silently returning the original as if nothing had happened. */
type RecoveryGate = { readonly attempt: false; readonly outcome: ToolExecutionResult } | { readonly attempt: true; readonly plan: RemedyPlan };

function resolveRecoveryGate(input: {
  readonly diagnostic: ActionableToolFailureDiagnostic;
  readonly principal: Principal;
  readonly originalInput: unknown;
  readonly registry: Pick<ToolRegistry, "list">;
  readonly result: ToolExecutionResult;
  readonly deps: ToolFailureRecoveryDeps;
}): RecoveryGate {
  const { diagnostic, principal, originalInput, registry, result, deps } = input;

  const readOnlyRefusal = refuseNonReadOnlyDispatch({ principal, toolId: diagnostic.remedyToolId, registry, messages: deps.readOnlyMessages }, {});
  if (readOnlyRefusal !== null) return { attempt: false, outcome: { ...result, error: deps.formatReadOnlyRemedyRefusal({ refusal: readOnlyRefusal }) } };

  const descriptor = registry.list({}).find((d) => d.id === diagnostic.remedyToolId);
  const plan = diagnostic.setupToolId
    ? planCredentialSetup({ diagnostic, descriptor, deps }, {})
    : planRemedyCall({ remedyToolId: diagnostic.remedyToolId, descriptor, originalInput });
  if (!plan) return { attempt: false, outcome: result };

  return { attempt: true, plan };
}

/** Wires the recovery surface's exchange to close if the caller aborts mid-ask, delegates to
 *  {@link resolveRecoveryDecision} for the actual answer, and always tears the listener back down —
 *  pulled out of `execute` so the abort-wiring's own optional chaining does not count toward that
 *  method's own complexity. */
async function collectRecoveryDecision(input: {
  readonly exchange: SurfaceExchange;
  readonly ui: unknown;
  readonly askForKey: string | undefined;
  readonly signal: AbortSignal | undefined;
}): Promise<RecoveryDecision> {
  const { exchange, ui, askForKey, signal } = input;
  const closeOnAbort = () => exchange.close({});
  signal?.addEventListener("abort", closeOnAbort, { once: true });
  try {
    return await resolveRecoveryDecision(exchange, ui, askForKey);
  } finally {
    signal?.removeEventListener("abort", closeOnAbort);
  }
}

/** The remedy tool's own input, built from the accepted {@link RemedyPlan}: the planned carry-forward
 *  fields plus, when one was asked for and answered, the human's own value under that field's key —
 *  never anything else from the delivered surface response (see this file's header, "What it never
 *  does"). */
function buildRemedyInput(plan: RemedyPlan, decision: Extract<RecoveryDecision, { proceed: true }>): Record<string, unknown> {
  const remedyInput: Record<string, unknown> = { ...plan.carryForward };
  if (plan.askFor && decision.answerValue !== undefined) remedyInput[plan.askFor.key] = decision.answerValue;
  return remedyInput;
}

/**
 * Wraps `inner` with the generic ask -> apply -> retry-once recovery loop described in this file's
 * header. A drop-in `ToolExecutor` — every method other than `execute` delegates straight through,
 * matching `tool-executor-audit.ts`'s own `withToolAttemptAudit` shape.
 *
 * @complexity The no-hint path (the overwhelming majority) is one `inner.execute` call plus one bounded
 *   output scan — O(1) beyond `inner`'s own cost. The recovery path adds at most two further
 *   `inner.execute` calls (the remedy, the retry) and one surface round trip.
 */
export function withToolFailureRecovery({ inner, ...deps }: ToolFailureRecoveryDeps & { inner: ToolExecutor }, _optional = {}): ToolExecutor {
  return {
    execute: async (required, optional = {}): Promise<ToolExecutionResult> => {
      const { principal, toolId, input } = required;
      const { signal, emitSurface } = optional;
      const result = await inner.execute(required, optional);

      // SILENCE STAYS FREE: everything but a completed call whose output carries an actionable
      // diagnostic returns `result` exactly as `inner` produced it — no extra work, no surface, no
      // added latency. This is the overwhelmingly common case.
      if (result.status !== "completed") return result;
      const diagnostic = findActionableDiagnostic(result.output);
      if (!diagnostic) return result;
      // No channel to ask through (a headless/synthetic caller) — never guess, never suppress.
      if (!emitSurface) return result;

      // A read-only execution may not be recovered by a remedy that writes, and this diagnostic's
      // shape must fit the one pattern this loop can safely act on — see `resolveRecoveryGate` and
      // `planRemedyCall`'s own docs for every reason either can decide not to proceed.
      // `withReadOnlyToolConstraint` would refuse the dispatch below regardless — it is the
      // enforcement, and it does not depend on this check — but a refusal discovered THERE arrives
      // only after a human has already been asked to fill in a form whose answer is then thrown away.
      const gate = resolveRecoveryGate({ diagnostic, principal, originalInput: input, registry: deps.registry, result, deps });
      if (!gate.attempt) return gate.outcome;

      let remedyInput: Record<string, unknown> = { ...gate.plan.carryForward };
      if (!diagnostic.setupToolId) {
        const exchange = deps.surfaceExchanges.open({ binding: { toolId: deps.recoveryToolId, principalId: principal.id }, emit: emitSurface });
        const ui = deps.buildRecoveryForm({ exchangeId: exchange.id, hint: diagnostic.hint, remedyToolId: diagnostic.remedyToolId, ...(gate.plan.askFor ? { askFor: gate.plan.askFor } : {}) }, {});
        const decision = await collectRecoveryDecision({ exchange, ui, askForKey: gate.plan.askFor?.key, signal });
        // Declined, dismissed, expired, or a blank answer — the ORIGINAL failure is still the truth.
        if (!decision.proceed) return result;
        remedyInput = buildRemedyInput(gate.plan, decision);
      }
      // Credential setup goes directly to the masked card; it supplies its own human decision.

      // ---- STRUCTURAL ONE-CYCLE GUARD ----
      // Both calls below go straight to `inner` — never back through this function or the object it
      // returns. Whatever either one returns, including a fresh hint+remedyToolId of its own, is never
      // fed back into the scan above: that scan is written exactly once, above this comment, and
      // nothing here loops or recurses into it again. See this file's header.
      const remedyResult = await inner.execute({ ...required, toolId: diagnostic.remedyToolId, input: remedyInput }, optional);
      // The fix itself did not complete (denied, threw, timed out, ...) — nothing changed, so retrying
      // the original would only reproduce the same failure. Return the ORIGINAL result, untouched.
      if (remedyResult.status !== "completed") return result;
      // The remedy RAN, but its own result says the fix was never actually applied (a declined,
      // expired, or invalid human-gated write) — see {@link remedyReportedFailure}. "Completed" is not
      // "succeeded"; retrying here would only reproduce the same failure.
      if (remedyReportedFailure(remedyResult.output)) return result;

      // Retry the ORIGINAL call exactly once, with its exact original input. Whatever this returns —
      // success or a fresh failure — is this wrapper's final answer.
      return inner.execute(required, optional);
    },
    resumeConfirmation: (required) => inner.resumeConfirmation(required),
    cancel: (required) => inner.cancel(required),
    getAuditRecord: (required) => inner.getAuditRecord(required),
  };
}
