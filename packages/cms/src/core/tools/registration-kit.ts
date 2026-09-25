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
 * What is deliberately NOT abstracted here is the authorization DECISION. {@link requireToolPermission}
 * performs a check a caller asks for; it never decides that a check is needed. The "one
 * evaluator" rule is a per-tool fact — some domains self-enforce inside their service function and
 * must NOT be double-checked here, others have no service-layer gate at all and must be checked at
 * the handler — and that judgement stays recorded in the domain file next to the handler it
 * describes, where a reviewer reading the handler can see it.
 */
import { ToolInputError, type ToolHandler, type ToolRegistration } from "@jini-ai/core";

// Imported from `../commands/command` rather than the `../commands` barrel deliberately. The barrel
// re-exports `appliers.ts`, which names `features/post` and `features/settings` directly, so any file
// reaching this kit through the barrel inherits a dependency on two specific features. Every domain's
// `tool-registrations.ts` imports this kit, so that one barrel hop is what welds the tool layer to the
// content features and makes domains like `identity` non-extractable. Both symbols below are defined
// in `command.ts`; importing them from there costs nothing and keeps the kit feature-agnostic.
import { ForbiddenError, type AuthorizeFn } from "../commands/command.js";

// Re-exported so a domain file's imports read as one line from this kit rather than a second import
// of `@jini-ai/core` alongside it — every domain needs both of these types and nothing else from
// that package.
export type { ToolHandler, ToolRegistration };

/**
 * Mirrors the `AgentToolSideEffect` union every domain's `agent-tools.ts` declares for itself.
 *
 * `deletes-durable-state` is a distinct member rather than a flavor of `mutates-durable-state`, and
 * the distinction is load-bearing rather than cosmetic. Every gate in this file compares the two
 * classifications for EQUALITY, so the strength of the check is exactly the resolution of the
 * vocabulary: folding a delete into `mutates-durable-state` would let a tool that removes content
 * from every read path carry the same declared risk as one that edits a title, and
 * {@link assertToolIsWirable} would have nothing to object to. A separate member means a delete tool
 * whose declaration drifts toward the milder classification fails the build.
 *
 * Widening this union is safe for the twelve domains that declare their own narrower copy: a
 * narrower union stays assignable to this one, and nothing in the codebase switches exhaustively on
 * the type (verified by grep before adding the member).
 */
export type AgentToolSideEffect =
  | "none"
  | "mutates-durable-state"
  | "deletes-durable-state"
  | "mints-token";

/** Mirrors the `AgentToolActorClassRule` union every domain's `agent-tools.ts` declares for itself. */
export type AgentToolActorClassRule = "confirmer-must-equal-own-delegatedBy" | "user-only" | "none";

/**
 * The structural minimum this wiring layer needs from a catalog entry, satisfied by every domain's
 * own `AgentToolDefinition` without any of them having to import it.
 *
 * Deliberately a structural supertype rather than a single shared interface the twelve catalogs
 * would all import: those catalogs are domain-owned declarations, and a domain must stay
 * free to tighten its own copy — `identity/agent-tools.ts` makes `inputSchema` REQUIRED because
 * every one of its entries is wired, and adds `authorization.orPermission` because three of its
 * gates are genuinely an OR. Both remain assignable to this. Widening happens here, in the consumer,
 * so no domain's declaration is loosened to accommodate another's.
 */
export interface WirableToolDefinition {
  name: string;
  description: string;
  sideEffects: AgentToolSideEffect;
  authorization: { permission: string; orPermission?: string };
  actorClassRule?: AgentToolActorClassRule;
  inputSchema?: Readonly<Record<string, unknown>>;
}

/**
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
 * @returns A handler {@link assertToolIsWirable} accepts for a tool carrying the rule.
 * @complexity O(1) plus the three steps.
 */
export function humanConfirmedHandler<TPrepared>(steps: {
  prepare: (ctx: Parameters<ToolHandler>[0]) => Promise<TPrepared>;
  askHuman: (ctx: Parameters<ToolHandler>[0], prepared: TPrepared) => Promise<HumanConfirmationAnswer>;
  run: (ctx: Parameters<ToolHandler>[0], prepared: TPrepared, confirmer: HumanConfirmer) => Promise<unknown>;
}): ToolHandler {
  const handler: ToolHandler = async (ctx) => {
    const prepared = await steps.prepare(ctx);
    const answer = await steps.askHuman(ctx, prepared);
    if (answer.confirmed !== true) return answer.result;
    return steps.run(ctx, prepared, { id: ctx.principal.id, kind: "user" });
  };
  HUMAN_CONFIRMED_HANDLERS.add(handler);
  return handler;
}

/**
 * Indexes a domain catalog by tool id — the single lookup used for descriptors, risk metadata, and
 * schema-bearing error messages.
 *
 * @param catalog - The domain's own `agent-tools.ts` catalog array.
 * @returns The catalog keyed by `name`.
 * @complexity O(n) once at module load, O(1) per subsequent lookup.
 * @overallScore 100
 */
export function indexCatalogById<T extends { name: string }>(catalog: readonly T[]): ReadonlyMap<string, T> {
  return new Map(catalog.map((tool) => [tool.name, tool]));
}

// ---------------------------------------------------------------------------
// Input readers — the vocabulary every handler uses to read `ctx.input`.
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Narrows `ctx.input` to a record, refusing anything else. The first line of most handlers. */
export function requireInputRecord(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) throw new ToolInputError("input must be an object");
  return input;
}

export function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolInputError(`'${key}' (non-empty string) is required`);
  }
  return value;
}

export function requireNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ToolInputError(`'${key}' (number) is required`);
  }
  return value;
}

export function requireObject(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = input[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolInputError(`'${key}' (object) is required`);
  }
  return value as Record<string, unknown>;
}

export function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ToolInputError(`'${key}' must be a string`);
  return value;
}

export function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ToolInputError(`'${key}' must be a number`);
  return value;
}

export function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ToolInputError(`'${key}' must be a boolean`);
  return value;
}

/**
 * The reader for a parameterless tool: `ctx.input` may be omitted entirely or passed as `{}`,
 * nothing else. Refusing a populated object is deliberate — silently ignoring keys would teach a
 * model that a filter it invented was applied.
 */
export function requireNoInput(input: unknown): void {
  if (input === undefined) return;
  if (!isRecord(input) || Object.keys(input).length > 0) {
    throw new ToolInputError("this tool accepts no input — omit 'input' or pass {}");
  }
}

/**
 * Wraps a `Result<T, Error>`-returning domain call as a value: `ToolExecutor` treats a thrown error
 * as a `'failed'` execution, so an `{ok:false}` becomes a throw rather than a silently-swallowed
 * value.
 */
export function fromResult<T>(fn: () => Promise<{ ok: true; value: T } | { ok: false; error: Error }>): Promise<T> {
  return fn().then((result) => {
    if (!result.ok) throw result.error;
    return result.value;
  });
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/**
 * Runs the identical inline `authorize()` check the corresponding admin HTTP route performs, for a
 * tool whose own domain function carries no `authorize()` call to inherit.
 *
 * This is NOT a second evaluator alongside another check — that is exactly the single-evaluator
 * rule's concern. For each tool that
 * calls it, this IS the only gate that tool's execution ever reaches, reached by an identical path
 * to the one a human clicking the same admin route reaches. Domains split cleanly on which kind
 * they are: content-types/Forms/Identity mutations and every Widgets write-service call self-enforce
 * inside the domain function and must NOT call this; Comments/Members/Newsletter/Media/Menus/
 * Database/Recovery gate in the route instead, so their handlers call this in the route's place.
 * Which kind a given tool is stays documented next to that tool's handler, not here.
 *
 * Throws `core/commands`'s `ForbiddenError` — the same class `executeCommand` itself throws — so a
 * tool caller and a route caller see the identical error shape for an identical denial. Throw
 * rather than a 403 body because the caller here is `ToolExecutor`, which reads a thrown error as a
 * failed execution and has no response to write to.
 *
 * @param deps - The `authorize()` evaluator and the workspace the run is scoped to.
 * @param required - Who is asking, for what permission, optionally against which entity.
 * @throws {ForbiddenError} If `authorize()` denies.
 * @complexity O(1) beyond the injected `authorize()` call.
 * @overallScore 100
 */
export async function requireToolPermission(
  deps: { authorize: AuthorizeFn; workspaceId: string },
  required: { principalId: string; permission: string; entityType?: string | undefined; entityId?: string | undefined },
): Promise<void> {
  const result = await deps.authorize({
    principalId: required.principalId,
    permission: required.permission,
    workspaceId: deps.workspaceId,
    entityType: required.entityType,
    entityId: required.entityId,
  });
  if (!result.allowed) {
    throw new ForbiddenError(
      `principal '${required.principalId}' is not authorized for '${required.permission}' (${result.reason})`,
      required.permission,
      result.reason,
    );
  }
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
 * @param fn - The domain call.
 * @throws The original error unchanged when it is not a shape rejection, or a decorated `Error`
 * when it is. A tool whose catalog entry publishes no schema still gets the retry-is-futile note.
 * @complexity O(1) beyond the wrapped call, plus the schema's own serialization on the failure path.
 * @overallScore 100
 */
export async function withSchemaOnRejection<T>(
  spec: {
    toolId: string;
    catalog: ReadonlyMap<string, WirableToolDefinition>;
    isShapeRejection: (error: unknown) => boolean;
  },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!spec.isShapeRejection(error)) throw error;
    throw decorateWithSchema({ toolId: spec.toolId, catalog: spec.catalog, message: (error as Error).message });
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
  catalog: ReadonlyMap<string, WirableToolDefinition>;
  message: string;
}): Error {
  const schema = params.catalog.get(params.toolId)?.inputSchema;
  // A `ToolInputError`, not a plain `Error`: every rejection reaching here already passed the
  // caller's own `isShapeRejection` predicate — "a DIFFERENT input would fix this" — which is
  // exactly what the marker means. `@jini-ai/daemon`'s `ToolExecutor` reads it off the thrown error
  // to tag the execution result `errorKind: 'validation'` rather than folding it into the same
  // redacted-500 bucket a genuine internal failure gets.
  return new ToolInputError(
    schema
      ? `${params.message}. ${RETRY_IS_FUTILE} Schema for '${params.toolId}': ${JSON.stringify(schema)}`
      : `${params.message}. ${RETRY_IS_FUTILE}`,
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
  catalogEntry: WirableToolDefinition;
  derivedRisk: DerivedRiskByToolId;
  handler?: ToolHandler;
}): void {
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
  if (needsHuman && !(params.handler && HUMAN_CONFIRMED_HANDLERS.has(params.handler))) {
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
 * function for the self-enforcing domains, or by the handler's own {@link requireToolPermission}
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
 * @param spec.unwiredToolIds - Catalog ids deliberately not wired. Omit when the domain wires its
 * entire catalog, which makes ANY unwired entry a build failure.
 * @throws {Error} On catalog drift, an unclassified/misclassified tool, a wired tool publishing no
 * `inputSchema`, or a catalog entry that is neither wired nor declared unwired.
 * @complexity O(h + c) in the handler and catalog counts.
 * @overallScore 100
 */
export function buildDomainRegistrations(spec: {
  domain: string;
  catalogModule: string;
  catalog: ReadonlyMap<string, WirableToolDefinition>;
  handlers: Record<string, ToolHandler>;
  derivedRisk: DerivedRiskByToolId;
  unwiredToolIds?: ReadonlySet<string>;
}): ToolRegistration[] {
  const registrations: ToolRegistration[] = [];

  for (const [id, handler] of Object.entries(spec.handlers)) {
    const catalogEntry = spec.catalog.get(id);
    if (!catalogEntry) {
      throw new Error(`tool-registrations: ${spec.domain} catalog has no entry named '${id}' — ${spec.catalogModule} drifted`);
    }
    assertToolIsWirable({ toolId: id, catalogEntry, derivedRisk: spec.derivedRisk, handler });
    if (!catalogEntry.inputSchema) {
      throw new Error(
        `tool-registrations: wired tool '${id}' publishes no inputSchema — add one to its entry in ${spec.catalogModule} so the model gets a contract, or leave the tool unwired`,
      );
    }
    registrations.push({
      descriptor: {
        id,
        description: catalogEntry.description,
        inputSchema: catalogEntry.inputSchema,
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
    if (spec.unwiredToolIds?.has(id)) continue;
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
export function mergeDerivedRiskMaps(slices: readonly { domain: string; risk: DerivedRiskByToolId }[]): DerivedRiskByToolId {
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
