import { humanConfirmedHandler, requireInputRecord, type HumanConfirmationAnswer, type HumanConfirmer } from './registration-kit.js';
import { ToolInputError } from './tool-registry.js';
import type { ToolExecutionContext, ToolExecutionOptions, ToolHandler, ToolRegistration } from './tool-registry.js';

/** A host describes the action; core owns the decision lifecycle, never the card format. */
export interface ApprovalPlan<TDescription> {
  readonly ask: boolean;
  readonly description: TDescription;
  /** Only reusable escalation grants receive a key. Irreversible actions omit it. */
  readonly rememberKey?: string;
}
export type ApprovalAnswer = { confirmed: true; choice?: string } | { confirmed: false; reason: 'declined' | 'expired' | 'abandoned' };

/** The decision reducer shared by parked tool calls and the browser's explicit reply transport.
 * An answer never revives an aborted operation. Transport failures propagate without an effect. */
export async function resolveApproval(
  { signal, askHuman }: { signal: AbortSignal; askHuman: () => Promise<ApprovalAnswer> }, _optional = {},
): Promise<ApprovalAnswer> {
  if (signal.aborted) return { confirmed: false, reason: 'abandoned' };
  let abandon!: () => void;
  const aborted = new Promise<ApprovalAnswer>(resolve => { abandon = () => resolve({ confirmed: false, reason: 'abandoned' }); });
  signal.addEventListener('abort', abandon, { once: true });
  try {
    const answer = await Promise.race([askHuman(), aborted]);
    return signal.aborted ? { confirmed: false, reason: 'abandoned' } : answer;
  } finally { signal.removeEventListener('abort', abandon); }
}
/** The confirmer is always the run's own delegating principal, as a user. */
const confirmerOf = (ctx: ToolExecutionContext): HumanConfirmer => ({ id: ctx.principal.id, kind: 'user' });

export interface RememberedApprovalPort {
  has(required: { ctx: ToolExecutionContext; key: string }): Promise<boolean>;
  grant(required: { ctx: ToolExecutionContext; key: string; confirmer: HumanConfirmer }): Promise<void>;
}
export interface ApprovalSteps<TPrepared, TDescription> {
  prepare(required: { ctx: ToolExecutionContext }, optional: ToolExecutionOptions): Promise<TPrepared>;
  describe(required: { ctx: ToolExecutionContext; prepared: TPrepared }, optional: ToolExecutionOptions): Promise<ApprovalPlan<TDescription>> | ApprovalPlan<TDescription>;
  askHuman(required: { ctx: ToolExecutionContext; description: TDescription }, optional: ToolExecutionOptions): Promise<ApprovalAnswer>;
  run(required: { ctx: ToolExecutionContext; prepared: TPrepared; confirmer: HumanConfirmer; choice?: string | undefined }, optional: ToolExecutionOptions): Promise<unknown>;
  /** Abort may happen before preparation; the lifecycle forwards that missing value explicitly. */
  notConfirmed(required: { reason: 'declined' | 'expired' | 'abandoned'; prepared?: TPrepared | undefined }): unknown;
}

/** Extend the branded human-confirm owner with descriptions and optional remembered grants.
 * Inputs and actor identity are detached before any asynchronous port runs. No input field can
 * approve an action; only the host transport or the bound grant store can answer. Abort checks
 * bracket preparation, storage and the human wait, so a completed run never performs an effect.
 * @param steps Domain preparation/effects and the host's description/transport ports.
 * @param optional.remembered A persisted escalation store; omission requires a fresh decision.
 * @returns A handler accepted by the registration kit's human-only actor rule.
 * @throws Port failures propagate; a failed store cannot silently authorize an action.
 * @complexity O(input size) for the snapshot plus bounded port calls and the human wait.
 * @example createApprovalHandler({ prepare, describe, askHuman, run, notConfirmed });
 */
export function createApprovalHandler<TPrepared, TDescription>(
  steps: ApprovalSteps<TPrepared, TDescription>,
  { remembered }: { remembered?: RememberedApprovalPort } = {},
): ToolHandler {
  type Prepared = { ctx: ToolExecutionContext; value?: TPrepared; plan?: ApprovalPlan<TDescription>; choice?: string | undefined };
  const confirmed = (): HumanConfirmationAnswer => ({ confirmed: true });
  const abandoned = (prepared: Prepared): HumanConfirmationAnswer => ({ confirmed: false, result: steps.notConfirmed({ reason: 'abandoned', prepared: prepared.value }) });
  /** A remembered grant applies only when the plan offers a key and the host bound a store. */
  const grantSlot = (plan: ApprovalPlan<TDescription>) =>
    plan.rememberKey !== undefined && remembered ? { store: remembered, key: plan.rememberKey } : undefined;

  /** Ask the host transport; record the choice and any reusable grant only on an explicit yes. */
  const askFresh = async (
    { prepared, plan }: { prepared: Prepared; plan: ApprovalPlan<TDescription> }, options: ToolExecutionOptions = {},
  ): Promise<HumanConfirmationAnswer> => {
    const { ctx } = prepared;
    const answer = await resolveApproval({ signal: ctx.signal, askHuman: () => steps.askHuman({ ctx, description: plan.description }, options) });
    if (ctx.signal.aborted) return abandoned(prepared);
    if (answer.confirmed !== true) return { confirmed: false, result: steps.notConfirmed({ reason: answer.reason, prepared: prepared.value }) };
    prepared.choice = answer.choice;
    const slot = grantSlot(plan);
    if (slot) await slot.store.grant({ ctx, key: slot.key, confirmer: confirmerOf(ctx) });
    return ctx.signal.aborted ? abandoned(prepared) : confirmed();
  };

  return humanConfirmedHandler<Prepared>({
    prepare: async ({ ctx }, options = {}) => {
      const snapshot = { ...ctx, input: structuredClone(ctx.input), principal: { ...ctx.principal }, run: { ...ctx.run } };
      if (snapshot.signal.aborted) return { ctx: snapshot };
      const value = await steps.prepare({ ctx: snapshot }, options);
      if (snapshot.signal.aborted) return { ctx: snapshot, value };
      const plan = await steps.describe({ ctx: snapshot, prepared: value }, options);
      return { ctx: snapshot, value, plan };
    },
    askHuman: async ({ prepared }, options = {}) => {
      const { ctx, plan } = prepared;
      if (ctx.signal.aborted || !plan) return abandoned(prepared);
      if (!plan.ask) return confirmed();
      const slot = grantSlot(plan);
      if (slot) {
        const approved = await slot.store.has({ ctx, key: slot.key });
        if (ctx.signal.aborted) return abandoned(prepared);
        if (approved) return confirmed();
      }
      return askFresh({ prepared, plan }, options);
    },
    run: ({ prepared }, options = {}) => {
      const { ctx, value, choice } = prepared;
      if (ctx.signal.aborted) return Promise.resolve(steps.notConfirmed({ reason: 'abandoned', prepared: value }));
      return steps.run({ ctx, prepared: value as TPrepared, confirmer: confirmerOf(ctx), choice }, options);
    },
  });
}

/** Prepare every item before asking once for the complete batch. Reuses the single-call approval
 * lifecycle, including its detached inputs, authenticated confirmer and abort checks.
 * Single inputs preserve their result shape. Batch effects run in order and stop on the first
 * failure; earlier effects are not rolled back. No remembered approval is accepted for a batch.
 * @throws ToolInputError for malformed, duplicate or over-cap batches, before preparation/effects.
 * @complexity O(s + n p log p) local time and O(s) snapshot space for s input/description bytes,
 * p top-level fields per item and n items (default cap 25), plus the injected preparation/effects. */
export function createBatchApprovalHandler<TPrepared, TDescription>(
  { steps, combineDescriptions }: {
    steps: ApprovalSteps<TPrepared, TDescription>;
    combineDescriptions(input: { descriptions: readonly TDescription[] }): TDescription;
  },
  { maxItems = 25 }: { maxItems?: number } = {},
): ToolHandler {
  type Entry = { ctx: ToolExecutionContext; prepared: TPrepared };
  type Batch = { batch: boolean; entries: Entry[] };
  return createApprovalHandler<Batch, TDescription>({
    prepare: async ({ ctx }, options) => {
      const input = requireInputRecord({ input: ctx.input });
      if (!Object.hasOwn(input, 'items')) return { batch: false, entries: [{ ctx, prepared: await steps.prepare({ ctx }, options) }] };
      const { items, ...defaults } = input;
      if (!Array.isArray(items) || items.length < 1 || items.length > maxItems) {
        throw new ToolInputError({ message: `items must contain between 1 and ${maxItems} inputs.` });
      }
      const contexts = items.map(item => {
        const fields = requireInputRecord({ input: item });
        if (Object.hasOwn(fields, 'items')) throw new ToolInputError({ message: 'Nested items batches are not supported.' });
        return { ...ctx, input: { ...defaults, ...fields } };
      });
      // These boundary inputs are records; sorting their keys also catches reordered scalar ids.
      const keys = contexts.map(({ input }) => JSON.stringify(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))));
      if (new Set(keys).size !== keys.length) throw new ToolInputError({ message: 'Duplicate batch inputs are not allowed.' });
      const entries: Entry[] = [];
      for (const itemCtx of contexts) entries.push({ ctx: itemCtx, prepared: await steps.prepare({ ctx: itemCtx }, options) });
      return { batch: true, entries };
    },
    describe: async ({ prepared }, options) => {
      const plans: ApprovalPlan<TDescription>[] = [];
      for (const entry of prepared.entries) plans.push(await steps.describe(entry, options));
      if (!prepared.batch) return plans[0]!;
      return { ask: true, description: combineDescriptions({ descriptions: plans.map(plan => plan.description) }) };
    },
    askHuman: steps.askHuman,
    run: async ({ prepared, confirmer, choice }, options) => {
      if (!prepared.batch) return steps.run({ ...prepared.entries[0]!, confirmer, choice }, options);
      const results: unknown[] = [];
      for (const entry of prepared.entries) {
        if (entry.ctx.signal.aborted) return steps.notConfirmed({ reason: 'abandoned' });
        results.push(await steps.run({ ...entry, confirmer, choice }, options));
      }
      return { batch: true, total: results.length, results };
    },
    notConfirmed: ({ reason, prepared }) => steps.notConfirmed({ reason, prepared: prepared?.batch ? undefined : prepared?.entries[0]?.prepared }),
  });
}

/** Page-local proposal transport for a browser that must return before its explicit reply arrives.
 * It carries no principal or tool authorization: the host's execute port must re-check access.
 * The private action is independent of the rendered snapshot; replies consume it before awaiting
 * so double clicks/replayed replies cannot execute twice. Abort clears the proposal and listener.
 * @returns An observable transport for an app dialog and its authenticated reply entry point.
 * @complexity O(description size) to detach the proposal; O(listeners) to publish a change.
 */
export function createApprovalProposalStore<TDescription>(
  { responseTool, messages }: { responseTool: string; messages: { closed: string; pending: string; missing: string } },
  { createId = () => crypto.randomUUID() }: { createId?: () => string } = {},
) {
  type Pending = { approvalId: string; description: TDescription };
  type Snapshot = { pending: Pending | null; error: string | null };
  let snapshot: Snapshot = { pending: null, error: null };
  let action: { approvalId: string; execute: () => Promise<unknown>; signal: AbortSignal } | null = null;
  let detach: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot) => { snapshot = next; for (const listener of listeners) listener(); };
  const clear = () => {
    detach?.(); detach = null; action = null; publish({ pending: null, error: null });
  };
  return {
    getSnapshot: (_required = {}, _optional = {}) => snapshot,
    subscribe: ({ listener }: { listener: () => void }, _optional = {}) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    propose({ description, execute, signal }: { description: TDescription; execute: () => Promise<unknown>; signal: AbortSignal }, _optional = {}) {
      if (signal.aborted) throw new Error(messages.closed);
      if (snapshot.pending) throw new Error(messages.pending);
      const frozenDescription = structuredClone(description);
      const approvalId = createId();
      action = { approvalId, execute, signal };
      signal.addEventListener('abort', clear, { once: true });
      detach = () => signal.removeEventListener('abort', clear);
      publish({ pending: { approvalId, description: structuredClone(frozenDescription) }, error: null });
      return { status: 'approval_required' as const, approvalId, description: frozenDescription, responseTool };
    },
    async respond({ approvalId, approved }: { approvalId: string; approved: boolean }, _optional = {}) {
      if (!action || action.approvalId !== approvalId) throw new Error(messages.missing);
      const prepared = action;
      clear();
      const answer = await resolveApproval({ signal: prepared.signal, askHuman: async () => approved === true ? { confirmed: true } : { confirmed: false, reason: 'declined' } });
      if (!answer.confirmed) return { status: 'declined' };
      try { return await prepared.execute(); }
      catch (error) { publish({ ...snapshot, error: error instanceof Error ? error.message : String(error) }); throw error; }
    },
  };
}

/** Apply a host classification through the same handler owner used by domain plans.
 * @returns The registration with one approval handler; authorization policy is preserved.
 */
export function applyApprovalPolicy<TDescription>(
  { registration, classify, asks, describe, askHuman, notConfirmed }: {
    registration: ToolRegistration;
    classify(required: { input: unknown }): string;
    asks(required: { class: string }): boolean;
    describe(required: { ctx: ToolExecutionContext; class: string }): Promise<TDescription>;
    askHuman: ApprovalSteps<string, TDescription>['askHuman'];
    notConfirmed: ApprovalSteps<string, TDescription>['notConfirmed'];
  },
  optional: { remembered?: RememberedApprovalPort } = {},
): ToolRegistration {
  return { ...registration, handler: createApprovalHandler({
    prepare: async ({ ctx }) => classify({ input: ctx.input }),
    describe: async ({ ctx, prepared }) => ({ ask: asks({ class: prepared }), description: await describe({ ctx, class: prepared }) }),
    askHuman, notConfirmed,
    run: ({ ctx }, options) => registration.handler(ctx, options),
  }, optional) };
}
