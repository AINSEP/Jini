import { humanConfirmedHandler, type HumanConfirmer } from './registration-kit.js';
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
      const { ctx, plan, value } = prepared;
      const abandoned = () => ({ confirmed: false as const, result: steps.notConfirmed({ reason: 'abandoned', prepared: value }) });
      if (ctx.signal.aborted || !plan) return abandoned();
      if (!plan.ask) return { confirmed: true };
      if (plan.rememberKey !== undefined && remembered) {
        const approved = await remembered.has({ ctx, key: plan.rememberKey });
        if (ctx.signal.aborted) return abandoned();
        if (approved) return { confirmed: true };
      }
      const answer = await resolveApproval({ signal: ctx.signal, askHuman: () => steps.askHuman({ ctx, description: plan.description }, options) });
      if (ctx.signal.aborted) return abandoned();
      if (answer.confirmed !== true) return { confirmed: false, result: steps.notConfirmed({ reason: answer.reason, prepared: value }) };
      prepared.choice = answer.choice;
      if (plan.rememberKey !== undefined && remembered) {
        await remembered.grant({ ctx, key: plan.rememberKey, confirmer: { id: ctx.principal.id, kind: 'user' } });
      }
      if (ctx.signal.aborted) return abandoned();
      return { confirmed: true };
    },
    run: ({ prepared }, options = {}) => {
      const { ctx, value, choice } = prepared;
      if (ctx.signal.aborted) return Promise.resolve(steps.notConfirmed({ reason: 'abandoned', prepared: value }));
      return steps.run({ ctx, prepared: value as TPrepared, confirmer: { id: ctx.principal.id, kind: 'user' }, choice }, options);
    },
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
