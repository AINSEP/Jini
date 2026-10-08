/**
 * @file The cross-domain half of the agent-tool wiring split: everything a domain's own
 * `tool-registrations.ts` needs that is NOT specific to that domain.
 *
 * Why this file exists at all. Every domain's wiring repeats the same five moves — index its
 * catalog by id, read a handful of fields off `ctx.input`, run the tool's permission check,
 * decorate a shape rejection with the published schema, and then loop the handler map into
 * `ToolRegistration`s behind a build-time risk/schema gate. Those five moves were previously copied
 * per domain inside one shared `assistant/tool-registrations.ts`, which is exactly why that file
 * grew past 2000 lines and why three independent domain slices could not be developed in parallel
 * without colliding on it. Each domain now owns a `tool-registrations.ts` next to its own code and
 * imports the shared moves from here; `assistant/tool-registrations.ts` is reduced to the
 * aggregator that assembles them.
 *
 * The membership test for anything in this file is "would a fourth, not-yet-written domain need
 * it?". Domain-shaped things deliberately stay out: each domain's model-facing `to*View`
 * projections, its dependency-bag builder, its own `DERIVED_RISK_BY_TOOL_ID` slice (a claim about
 * that domain's handlers, so it is maintained where those handlers live), and its unwired-tool set.
 *
 * What is deliberately NOT abstracted here is the authorization DECISION. The host's permission helper
 * performs a check a caller asks for; it never decides that a check is needed. The "one
 * evaluator" rule is a per-tool fact — some domains self-enforce inside their service function and
 * must NOT be double-checked here, others have no service-layer gate at all and must be checked at
 * the handler — and that judgement stays recorded in the domain file next to the handler it
 * describes, where a reviewer reading the handler can see it.
 */
import { ToolInputError, type ToolExecutionOptions, type ToolHandler, type ToolRegistration } from "./tool-registry.js";
import type { Result } from "./primitives/index.js";
import type { AgentToolSideEffect, AgentToolDefinition } from "./agent-tools.js";
import { toolMetadataFor } from "./tool-metadata.js";

/**
 * Catalog entries use the kernel's AgentToolDefinition. The distinct deletion classification
 * and its rationale live beside that contract in agent-tools.ts: every wiring gate compares
 * classifications for equality, so deleting durable state cannot pass as a milder edit.
 *
 * This remains a structural minimum. A domain may tighten its own catalog, for example by
 * requiring inputSchema for every wired entry or declaring authorization.orPermission for
 * real OR gates. Neither requires importing another domain or loosening its own contract.
 *
 * A domain's independent classification of what its own handlers actually do, keyed by tool id.
 *
 * The point of the type is the point of the pattern: a tool's risk must not be self-declared. A
 * catalog entry that quietly downgraded itself to `sideEffects:'none'` would otherwise become
 * "safe" by editing one word in a file that carries no knowledge of which domain function runs.
 * Each domain's `tool-registrations.ts` maintains its slice next to the handlers it describes, and
 * {@link assertToolIsWirable} refuses to build when the two disagree. An id absent from the map
 * cannot be wired at all, so the conservative default is "refuse", not "assume safe".
 */
export type DerivedRiskByToolId = ReadonlyMap<string, AgentToolSideEffect>;

/**
 * Audit provenance stamped onto every revision row a tool handler writes.
 *
 * A constant, not `ctx.principal`'s own kind, and that is the point: `ctx.principal.id` is the
 * HUMAN admin's principal id — the host's proxy reads it from the browser session and stamps it
 * into the run's `contextRef`, and the daemon hands it back to the handler. So a content-type change made by the assistant and one the same person made by clicking
 * through the admin UI record an identical `actorId`. What distinguishes them is the path, and
 * reaching a `tool-registrations.ts` handler IS the agent path — those handlers are only ever
 * invoked by `@jini-ai/daemon`'s `ToolExecutor` during a run. `'agent'` is therefore a fact about
 * the call site, not a default.
 */
// Typed as the literal "agent" (not the wider `ActorPrincipalKind`/`CommandActor["kind"]` unions
// each domain declares) so this one constant satisfies both content-types' `principalKind` param
// and Forms' `CommandActor.kind` param without a cast at either call site.
export const AGENT_TOOL_PRINCIPAL_KIND: "agent" = "agent";

/**
 * Actor-class rules that need a human confirmer.
 *
 * `confirmer-must-equal-own-delegatedBy` means "a human must confirm this, and the confirmer must
 * be the principal who delegated". The kit never delivers that through `descriptor.requiresConfirmation`:
 * without a host `ExecutionDelegate`, that flag parks the execution on a promise only
 * `resumeConfirmation` can settle, and nothing would call it (unbounded, too, because
 * `descriptor.timeoutMs`'s timer is armed only AFTER the confirmation await).
 *
 * So a tool carrying this rule is wirable only when its handler was built with
 * {@link humanConfirmedHandler}, which asks the human through the host's own confirmation transport
 * and runs the action only on an explicit yes. Any other handler fails the build.
 */
export const ACTOR_CLASS_RULES_REQUIRING_CONFIRMATION_TRANSPORT = new Set(["confirmer-must-equal-own-delegatedBy"]);

/**
 * The human who confirmed, as {@link humanConfirmedHandler} hands it to `run`: always the run's own
 * delegating principal (`ctx.principal.id`, see {@link AGENT_TOOL_PRINCIPAL_KIND}), always
 * `kind: "user"`. The only thing a `run` step may pass to a confirm step as its confirmer.
 */
export interface HumanConfirmer {
  readonly id: string;
  readonly kind: "user";
}

/** What the host's transport reports back. Only exactly `confirmed: true` counts as a yes. */
export type HumanConfirmationAnswer = { confirmed: true } | { confirmed: false; result: unknown };

const HUMAN_CONFIRMED_HANDLERS = new WeakSet<ToolHandler>();

/**
 * Builds the one kind of handler a `confirmer-must-equal-own-delegatedBy` tool may be wired with
 * (see {@link ACTOR_CLASS_RULES_REQUIRING_CONFIRMATION_TRANSPORT}).
 *
 * The order is fixed here, not left to each domain: `prepare` (validate, pre-authorize, derive what
 * the human will see) → `askHuman` (the host's transport, e.g. an MCP-UI dialog) → `run`, only when
 * the answer is exactly `{ confirmed: true }`. The decision never comes from `ctx.input`, so nothing
 * the model sends can stand in for the human. `run` gets the confirmer as the delegating human.
 *
 * @param steps.prepare - Reads input and derives what the human is asked about. May throw.
 * @param steps.askHuman - Asks the human through the host's transport. Throws when no human can be
 *   asked; a no-answer returns `{ confirmed: false, result }` and `result` is the tool's result.
 * @param steps.run - Performs the action on a yes.
 * Each step receives the invoking transport's execution options as its second argument so
 * the confirmation dialog can be emitted before awaiting the human's answer.
 * @returns A handler {@link assertToolIsWirable} accepts for a tool carrying the rule.
 * @complexity O(1) plus the three steps.
 */
export function humanConfirmedHandler<TPrepared>(steps: {
  prepare: (required: { ctx: Parameters<ToolHandler>[0] }, optional?: ToolExecutionOptions) => Promise<TPrepared>;
  askHuman: (required: { ctx: Parameters<ToolHandler>[0]; prepared: TPrepared }, optional?: ToolExecutionOptions) => Promise<HumanConfirmationAnswer>;
  run: (required: { ctx: Parameters<ToolHandler>[0]; prepared: TPrepared; confirmer: HumanConfirmer }, optional?: ToolExecutionOptions) => Promise<unknown>;
}, _optional: Record<string, never> = {}): ToolHandler {
  const handler: ToolHandler = async (ctx, optional) => {
    const prepared = await steps.prepare({ ctx }, optional);
    const answer = await steps.askHuman({ ctx, prepared }, optional);
    if (answer.confirmed !== true) return answer.result;
    return steps.run({ ctx, prepared, confirmer: { id: ctx.principal.id, kind: "user" } }, optional);
  };
  HUMAN_CONFIRMED_HANDLERS.add(handler);
  return handler;
}

/**
 * Indexes a domain catalog by tool id — the single lookup used for descriptors, risk metadata, and
 * schema-bearing error messages.
 *
 * @param required.catalog - The domain's own `agent-tools.ts` catalog array.
 * @returns The catalog keyed by `name`.
 * @complexity O(n) once at module load, O(1) per subsequent lookup.
 * @overallScore 100
 */
export function indexCatalogById<T extends { name: string }>(required: { catalog: readonly T[] }, _optional: Record<string, never> = {}): ReadonlyMap<string, T> {
  return new Map(required.catalog.map((tool) => [tool.name, tool]));
}

// ---------------------------------------------------------------------------
// Input readers — the vocabulary every handler uses to read `ctx.input`.
// ---------------------------------------------------------------------------

export function isRecord(required: { value: unknown }, _optional: Record<string, never> = {}): required is { value: Record<string, unknown> } {
  const { value } = required;
  return typeof value === "object" && value !== null;
}

/**
 * Accepts non-null, non-array objects, including class instances and null-prototype records.
 * This is a shape check, not plain-object validation or sanitization. Keep `isRecord`'s
 * broader contract: existing tool readers deliberately continue to accept arrays.
 * @param required.value - The untrusted value whose object shape is checked.
 */
export function isNonArrayRecord(required: { value: unknown }, _optional: Record<string, never> = {}): required is { value: Record<string, unknown> } {
  return isRecord(required) && !Array.isArray(required.value);
}

/** Narrows `ctx.input` to a record, refusing anything else. The first line of most handlers. */
export function requireInputRecord(required: { input: unknown }, _optional: Record<string, never> = {}): Record<string, unknown> {
  const { input } = required;
  const candidate = { value: input };
  if (!isRecord(candidate)) throw new ToolInputError({ message: "input must be an object" });
  return candidate.value;
}

export function requireString(required: { input: Record<string, unknown>; key: string }, _optional: Record<string, never> = {}): string {
  const { input, key } = required;
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolInputError({ message: `'${key}' (non-empty string) is required` });
  }
  return value;
}

export function requireNumber(requiredArgs: { input: Record<string, unknown>; key: string }, optionalArgs: Record<string, never> = {}): number {
  const { input, key } = requiredArgs;
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ToolInputError({ message: `'${key}' (number) is required` });
  }
  return value;
}

export function requireObject(requiredArgs: { input: Record<string, unknown>; key: string }, optionalArgs: Record<string, never> = {}): Record<string, unknown> {
  const { input, key } = requiredArgs;
  const value = input[key];
  const candidate = { value };
  if (!isRecord(candidate) || Array.isArray(candidate.value)) {
    throw new ToolInputError({ message: `'${key}' (object) is required` });
  }
  return candidate.value;
}

export function optionalString(required: { input: Record<string, unknown>; key: string }, _optional: Record<string, never> = {}): string | undefined {
  const { input, key } = required;
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ToolInputError({ message: `'${key}' must be a string` });
  return value;
}

export function optionalNumber(requiredArgs: { input: Record<string, unknown>; key: string }, optionalArgs: Record<string, never> = {}): number | undefined {
  const { input, key } = requiredArgs;
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ToolInputError({ message: `'${key}' must be a number` });
  return value;
}

export function optionalBoolean(requiredArgs: { input: Record<string, unknown>; key: string }, optionalArgs: Record<string, never> = {}): boolean | undefined {
  const { input, key } = requiredArgs;
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ToolInputError({ message: `'${key}' must be a boolean` });
  return value;
}

/**
 * Reads a list tool's page-size field. A list schema's `minimum: 1, maximum: <max>` is advice to the
 * model, not enforcement: without this a `limit` of 0, -5 or 2.5 reached the query and came back as an
 * empty or nonsensical page the model could not tell apart from "no rows".
 *
 * @param required.max The schema's documented cap; a larger request is capped to it, not refused,
 *   because the schemas promise "server-capped at <max>".
 * @param required.fallback Returned when the key is absent.
 * @param _optional.key The field name, `limit` by default; it is also the name the error message uses.
 * @returns An integer in `[1, max]`.
 * @throws {ToolInputError} when the value is present but not an integer >= 1.
 * @complexity O(1).
 */
export function readToolLimit(
  required: { input: Record<string, unknown>; max: number; fallback: number },
  _optional: { key?: string } = {},
): number {
  const { input, max, fallback } = required;
  const key = _optional.key ?? "limit";
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ToolInputError({ message: `'${key}' must be an integer between 1 and ${max}` });
  }
  return Math.min(value, max);
}

/**
 * Reads an optional enum field (a list filter's `status`, say). An off-enum value is refused rather
 * than passed through, because as a filter it silently matches nothing and reads as "no rows".
 *
 * @param required.values The schema's `enum`, in the order the error message lists them.
 * @returns The value, or `undefined` when the key is absent.
 * @throws {ToolInputError} naming every allowed value when the value is present but not listed.
 * @complexity O(values).
 */
export function optionalOneOf<T extends string>(
  required: { input: Record<string, unknown>; key: string; values: readonly T[] },
  _optional: Record<string, never> = {},
): T | undefined {
  const { input, key, values } = required;
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    throw new ToolInputError({ message: `'${key}' must be one of: ${values.join(", ")}` });
  }
  return value as T;
}

/**
 * The reader for a parameterless tool: `ctx.input` may be omitted entirely or passed as `{}`,
 * nothing else. Refusing a populated object is deliberate — silently ignoring keys would teach a
 * model that a filter it invented was applied.
 */
export function requireNoInput(required: { input: unknown }, _optional: Record<string, never> = {}): void {
  const { input } = required;
  if (input === undefined) return;
  const candidate = { value: input };
  if (!isRecord(candidate) || Object.keys(candidate.value).length > 0) {
    throw new ToolInputError({ message: "this tool accepts no input — omit 'input' or pass {}" });
  }
}

/**
 * Wraps a `Result<T, Error>`-returning domain call as a value: `ToolExecutor` treats a thrown error
 * as a `'failed'` execution, so an `{ok:false}` becomes a throw rather than a silently-swallowed
 * value.
 */
export function fromResult<T>(requiredArgs: { fn: () => Promise<Result<T>> }, optionalArgs: Record<string, never> = {}): Promise<T> {
  const { fn } = requiredArgs;
  return fn().then((result) => {
    if (!result.ok) throw result.error;
    return result.value;
  });
}

// ---------------------------------------------------------------------------
// Error recovery
// ---------------------------------------------------------------------------

/** Appended to every decorated rejection so a model does not burn a turn retrying an identical call. */
const RETRY_IS_FUTILE = "Fix the input and retry — this will not resolve on retry without an input change.";

/**
 * Re-throws a rejection with the tool's published `inputSchema` appended, so a model can correct
 * its call in a single turn instead of guessing the rest of the shape from one field's complaint.
 *
 * `isShapeRejection` is the domain's own decision and has no default: only errors a DIFFERENT input
 * would fix are decorated. A `ForbiddenError` or a slug conflict is not a shape problem, and
 * appending a schema to one would be noise the model must read past — worse, it would imply the
 * call is retryable when it is not.
 *
 * @param spec.toolId - The tool whose schema is published with the failure.
 * @param spec.catalog - The domain catalog, consulted for that schema.
 * @param spec.isShapeRejection - Predicate selecting the errors worth decorating.
 * @param spec.fn - The domain call.
 * @throws The original error unchanged when it is not a shape rejection, or a decorated `Error`
 * when it is. A tool whose catalog entry publishes no schema still gets the retry-is-futile note.
 * @complexity O(1) beyond the wrapped call, plus the schema's own serialization on the failure path.
 * @overallScore 100
 */
export async function withSchemaOnRejection<T>(
  spec: {
    toolId: string;
    catalog: ReadonlyMap<string, AgentToolDefinition>;
    isShapeRejection: (required: { error: unknown }) => boolean;
    fn: () => Promise<T>;
  },
  _optional: Record<string, never> = {},
): Promise<T> {
  try {
    return await spec.fn();
  } catch (error) {
    if (!spec.isShapeRejection({ error })) throw error;
    throw decorateWithSchema({ toolId: spec.toolId, catalog: spec.catalog, message: error !== null && typeof error === "object" && "message" in error ? String(error.message) : String(error) });
  }
}

/**
 * The synchronous half of {@link withSchemaOnRejection}, for a domain that validates BEFORE the
 * call rather than inside it (content-types parses `fields` at a boundary parser, so its rejection
 * never reaches a `try` around a domain call).
 *
 * @returns The `Error` to throw — returned rather than thrown so the caller's own `throw` keeps
 * TypeScript's control-flow narrowing at the call site.
 * @complexity O(s) in the serialized schema size, on the failure path only.
 * @overallScore 100
 */
export function decorateWithSchema(params: {
  toolId: string;
  catalog: ReadonlyMap<string, AgentToolDefinition>;
  message: string;
}): Error {
  const schema = params.catalog.get(params.toolId)?.inputSchema;
  // A `ToolInputError`, not a plain `Error`: every rejection reaching here already passed the
  // caller's own `isShapeRejection` predicate — "a DIFFERENT input would fix this" — which is
  // exactly what the marker means. `@jini-ai/daemon`'s `ToolExecutor` reads it off the thrown error
  // to tag the execution result `errorKind: 'validation'` rather than folding it into the same
  // redacted-500 bucket a genuine internal failure gets.
  return new ToolInputError({ message: schema
      ? `${params.message}. ${RETRY_IS_FUTILE} Schema for '${params.toolId}': ${JSON.stringify(schema)}`
      : `${params.message}. ${RETRY_IS_FUTILE}` }
  );
}

// ---------------------------------------------------------------------------
// Build-time gates
// ---------------------------------------------------------------------------

/**
 * Build-time gate on a single tool's risk metadata: refuses to wire a tool whose declared
 * `sideEffects` disagrees with the wiring layer's own {@link DerivedRiskByToolId} classification,
 * whose id that layer has not classified at all, or whose `actorClassRule` needs a human confirmer
 * its handler does not ask for.
 *
 * Throws rather than warning, and at registration time rather than call time: a metadata
 * inconsistency is a developer error that should stop the daemon booting, not a runtime condition
 * to degrade around.
 *
 * @param params.toolId - The wired tool id.
 * @param params.catalogEntry - Its `agent-tools.ts` entry, the declared side of the comparison.
 * @param params.derivedRisk - The wiring layer's independent classification, the derived side.
 * @param params.handler - The handler being wired; checked only for a tool carrying a rule in
 *   {@link ACTOR_CLASS_RULES_REQUIRING_CONFIRMATION_TRANSPORT}.
 * @throws {Error} If the tool is unclassified, misclassified, or needs a human confirmer its handler
 *   does not ask for.
 * @complexity O(1) — two map/set lookups.
 * @overallScore 100
 */
export function assertToolIsWirable(params: {
  toolId: string;
  catalogEntry: AgentToolDefinition;
  derivedRisk: DerivedRiskByToolId;
}, optional: {
  handler?: ToolHandler;
} = {}): void {
  const { toolId, catalogEntry } = params;
  const derived = params.derivedRisk.get(toolId);
  if (!derived) {
    throw new Error(
      `tool-registrations: '${toolId}' has no entry in DERIVED_RISK_BY_TOOL_ID — classify what its handler actually does before wiring it (unknown operations are refused, never assumed safe)`,
    );
  }
  if (derived !== catalogEntry.sideEffects) {
    throw new Error(
      `tool-registrations: '${toolId}' declares sideEffects '${catalogEntry.sideEffects}' but this layer derives '${derived}' from what its handler calls — reconcile the two rather than trusting the declaration`,
    );
  }
  const needsHuman = catalogEntry.actorClassRule && ACTOR_CLASS_RULES_REQUIRING_CONFIRMATION_TRANSPORT.has(catalogEntry.actorClassRule);
  if (needsHuman && !(optional.handler && HUMAN_CONFIRMED_HANDLERS.has(optional.handler))) {
    throw new Error(
      `tool-registrations: '${toolId}' declares actorClassRule '${catalogEntry.actorClassRule}', which needs a human confirmer — build its handler with humanConfirmedHandler so a human answers through the host's confirmation transport (see ACTOR_CLASS_RULES_REQUIRING_CONFIRMATION_TRANSPORT)`,
    );
  }
}

/**
 * Turns one domain's handler map into `ToolRegistration`s, applying every build-time gate the
 * wiring layer owes each tool, and tripwiring on any catalog entry that is neither wired nor
 * explicitly declared unwired.
 *
 * The tripwire is the reason this is one shared function rather than a loop each domain copies.
 * "Add a catalog entry, forget to wire it" is the failure this layer is meant to make impossible,
 * and a per-domain copy of the check is a per-domain opportunity to get it subtly wrong — one of
 * the copies this replaced omitted the schema assertion, another omitted the unwired-set escape
 * hatch. Silence is never the outcome: an unwired entry either appears in `unwiredToolIds` with a
 * recorded reason next to it, or the build fails.
 *
 * `policy.authorize` is a pass-through `'allow'` for every registration, and that is by design
 * rather than an omission: each tool's permission is evaluated exactly once — inside its domain
 * function for the self-enforcing domains, or by the handler's own host permission helper
 * call for the domains whose gate lives in the route. A check here would be a SECOND evaluator of
 * the same rule, and a `ToolPolicy`-only check would be bypassable by any future non-tool caller of
 * the same domain function, which is precisely why the chokepoint owns the gate.
 *
 * `descriptor.requiresConfirmation` is deliberately never set — a tool that needs a human confirm
 * asks inside its own {@link humanConfirmedHandler}; see
 * {@link ACTOR_CLASS_RULES_REQUIRING_CONFIRMATION_TRANSPORT}.
 *
 * @param spec.domain - Human-readable domain name, used only in failure messages.
 * @param spec.catalogModule - Path of the catalog file, named in the drift message so the failure
 * points at the file to edit.
 * @param spec.catalog - That domain's catalog indexed by id (see {@link indexCatalogById}).
 * @param spec.handlers - Tool id to handler. Registration order follows this map's key order.
 * @param spec.derivedRisk - The domain's own risk classification (see {@link DerivedRiskByToolId}).
 * @param optional.unwiredToolIds - Catalog ids deliberately not wired. Omit when the domain wires its
 * entire catalog, which makes ANY unwired entry a build failure.
 * @throws {Error} On catalog drift, an unclassified/misclassified tool, a wired tool publishing no
 * `inputSchema`, or a catalog entry that is neither wired nor declared unwired.
 * @complexity O(h + c) in the handler and catalog counts.
 * @overallScore 100
 */
export function buildDomainRegistrations(spec: {
  domain: string;
  catalogModule: string;
  catalog: ReadonlyMap<string, AgentToolDefinition>;
  handlers: Record<string, ToolHandler>;
  derivedRisk: DerivedRiskByToolId;
  /** Host vocabulary and reviewed action policy; risk remains independently checked above. */
  metadata?: import('./tool-metadata.js').ToolMetadataById;
}, optional: { unwiredToolIds?: ReadonlySet<string> } = {}): ToolRegistration[] {
  const registrations: ToolRegistration[] = [];

  for (const [id, handler] of Object.entries(spec.handlers)) {
    const catalogEntry = spec.catalog.get(id);
    if (!catalogEntry) {
      throw new Error(`tool-registrations: ${spec.domain} catalog has no entry named '${id}' — ${spec.catalogModule} drifted`);
    }
    assertToolIsWirable({ toolId: id, catalogEntry, derivedRisk: spec.derivedRisk }, { handler });
    if (!catalogEntry.inputSchema) {
      throw new Error(
        `tool-registrations: wired tool '${id}' publishes no inputSchema — add one to its entry in ${spec.catalogModule} so the model gets a contract, or leave the tool unwired`,
      );
    }
    const metadata = catalogEntry.metadata ?? toolMetadataFor({ toolId: id, metadata: spec.metadata });
    registrations.push({
      descriptor: {
        id,
        description: catalogEntry.description,
        inputSchema: catalogEntry.inputSchema,
        ...(metadata ? { metadata } : {}),
        // The ONE place a domain's declared risk becomes the descriptor flag every read-only gate
        // reads (`@jini-ai/core`'s `isReadOnlyTool`). Placed here rather than in each domain's
        // `tool-registrations.ts` for the same reason the drift tripwire is: twelve copies of this
        // line is twelve chances for one to say something different. Change what counts as
        // read-only and every domain follows.
        //
        // Safe to derive from the declaration only because `assertToolIsWirable` has ALREADY run
        // two lines above and refused any tool whose declared `sideEffects` disagrees with the
        // wiring layer's own `DERIVED_RISK_BY_TOOL_ID` classification — so by this point the
        // declaration has been independently corroborated, and a catalog entry cannot make itself
        // read-only by editing one word.
        readOnly: catalogEntry.sideEffects === "none",
      },
      handler,
      policy: { authorize: () => "allow" },
    });
  }

  for (const id of spec.catalog.keys()) {
    if (id in spec.handlers) continue;
    if (optional.unwiredToolIds?.has(id)) continue;
    throw new Error(
      `tool-registrations: ${spec.domain} catalog entry '${id}' is neither wired nor declared unwired — wire a handler for it, or add it to that domain's unwired set with the reason recorded next to it`,
    );
  }

  return registrations;
}

/**
 * Folds every domain's risk slice into the one map the assistant-level
 * `assertRiskMetadataIsWirable(toolId, catalogEntry)` consults, refusing any id two domains both
 * claim.
 *
 * That refusal is the structural answer to the failure this restructure was prompted by: three
 * domain slices were developed in parallel, each checking its new ids only against the ids that
 * existed before it started, so a name two of them both picked would have been discovered at
 * runtime as a silently double-registered tool. A cross-domain id collision now fails the build.
 * The one real collision in the current catalogs — `backup_create_restore_point`, declared by both
 * Database and Recovery — passes because Recovery declares it unwired and therefore contributes no
 * risk entry for it, which is exactly the resolution this check is meant to force.
 *
 * @param slices - Each domain's name (for the failure message) and its own risk map.
 * @throws {Error} If two domains classify the same tool id.
 * @complexity O(t) in the total classified-tool count.
 * @overallScore 100
 */
export function mergeDerivedRiskMaps(requiredArgs: { slices: readonly { domain: string; risk: DerivedRiskByToolId }[] }, optionalArgs: Record<string, never> = {}): DerivedRiskByToolId {
  const { slices } = requiredArgs;
  const merged = new Map<string, AgentToolSideEffect>();
  const ownerByToolId = new Map<string, string>();

  for (const slice of slices) {
    for (const [toolId, sideEffect] of slice.risk) {
      const owner = ownerByToolId.get(toolId);
      if (owner) {
        throw new Error(
          `tool-registrations: tool id '${toolId}' is wired by both the ${owner} and ${slice.domain} domains — one id must resolve to exactly one handler; wire it in whichever domain owns the real operation and declare it unwired in the other`,
        );
      }
      ownerByToolId.set(toolId, slice.domain);
      merged.set(toolId, sideEffect);
    }
  }

  return merged;
}
