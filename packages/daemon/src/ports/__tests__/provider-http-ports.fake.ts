/** Fakes of the provider-HTTP ports for route tests (R7): each records its calls and replays what a test
 * scripted, with no network, socket or disk. They implement the interfaces only; they never import `@jini-ai/agent-runtime`. */
import type { BaseUrlGuardPort, BaseUrlValidationResult, ProviderToolTurnPort, ProviderTurnEventRecord } from '@jini-ai/core/contracts/agents';

export interface FakeProviderCall { readonly member: string; readonly required: unknown; readonly optional: unknown }
export interface FakeProviderToolTurnPort extends ProviderToolTurnPort { readonly calls: FakeProviderCall[] }

export interface FakeProviderToolTurnScript {
  /** Events every runner reports through `onEvent`, in order. */
  readonly events?: readonly (ProviderTurnEventRecord & Record<string, unknown>)[];
  /** When set with an `executeTool` in the optional bag, the runner executes this call once after the events. */
  readonly toolCall?: unknown;
}

/** Every runner records its call, replays `events`, runs `toolCall` through the caller's `executeTool`, and ends with zero tool turns. */
export function fakeProviderToolTurnPort(script: FakeProviderToolTurnScript = {}): FakeProviderToolTurnPort {
  const calls: FakeProviderCall[] = [];
  const run = async (member: string, required: { onEvent(event: ProviderTurnEventRecord): void }, optional: { executeTool?(call: unknown): Promise<unknown> } | undefined): Promise<void> => {
    calls.push({ member, required, optional });
    for (const event of script.events ?? []) required.onEvent(event);
    if (script.toolCall !== undefined && optional?.executeTool) await optional.executeTool(script.toolCall);
  };
  const finished = { finishReason: 'stop', toolTurns: 0 };
  return {
    calls,
    async anthropic(required, optional) { await run('anthropic', required, optional); return { stopReason: 'end_turn', toolTurns: 0 }; },
    async openai(required, optional) { await run('openai', required, optional); return finished; },
    async azure(required, optional) { await run('azure', required, optional); return finished; },
    async google(required, optional) { await run('google', required, optional); return finished; },
    async ollama(required, optional) { await run('ollama', required, optional); return finished; },
  };
}

export interface FakeBaseUrlGuard extends BaseUrlGuardPort { readonly calls: { readonly baseUrl: string }[] }

/** A guard that passes every URL except the ones a test seeded with a verdict. */
export function fakeBaseUrlGuard(verdicts: Readonly<Record<string, BaseUrlValidationResult>> = {}): FakeBaseUrlGuard {
  const calls: { baseUrl: string }[] = [];
  return {
    calls,
    validate(required) { calls.push({ baseUrl: required.baseUrl }); return verdicts[required.baseUrl] ?? { parsed: new URL(required.baseUrl) }; },
  };
}
