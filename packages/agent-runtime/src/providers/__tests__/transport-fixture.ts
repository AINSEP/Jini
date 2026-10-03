import type { ProviderToolTurnInput, ProviderToolTurnOptions } from '../tool-turn.js';
import { providerTurnAdapters, runProviderToolTurn } from '../tool-turn.js';
import type { PinnedFetch } from '../connection-guard.js';

type Reply = { status: number; body: string };
type Handler = (count: number, body: Record<string, unknown>) => Reply;
const handlers = new Map<string, Handler>();
/** Pure replacement for the copied tests' loopback HTTP fixture. */
export async function startStubProviderServer({ handler }: { handler: Handler }): Promise<string> {
  const baseUrl = `http://127.0.0.1/fixture-${handlers.size}`;
  handlers.set(baseUrl, handler);
  return baseUrl;
}
/** Compatibility shape only inside tests: forwards options into the public two-object API. */
export async function runFixtureTurn(input: Omit<ProviderToolTurnInput, 'adapters'> & ProviderToolTurnOptions) {
  const { baseUrl, maxTokens, maxToolTurns, signal, ...required } = input;
  let count = 0;
  const fetchImpl: PinnedFetch = async ({ init }) => {
    const handler = handlers.get(baseUrl ?? '');
    if (!handler) throw new Error('Missing fixture handler');
    const reply = handler(++count, JSON.parse(String(init.body)) as Record<string, unknown>);
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, text: async () => reply.body,
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from(reply.body); } } };
  };
  const adapters = {
    anthropic: (required: Parameters<typeof providerTurnAdapters.anthropic>[0], optional: Parameters<typeof providerTurnAdapters.anthropic>[1] = {}) => providerTurnAdapters.anthropic(required, { ...optional, fetchImpl }),
    openai: (required: Parameters<typeof providerTurnAdapters.openai>[0], optional: Parameters<typeof providerTurnAdapters.openai>[1] = {}) => providerTurnAdapters.openai(required, { ...optional, fetchImpl }),
    azure: (required: Parameters<typeof providerTurnAdapters.azure>[0], optional: Parameters<typeof providerTurnAdapters.azure>[1] = {}) => providerTurnAdapters.azure(required, { ...optional, fetchImpl }),
    google: (required: Parameters<typeof providerTurnAdapters.google>[0], optional: Parameters<typeof providerTurnAdapters.google>[1] = {}) => providerTurnAdapters.google(required, { ...optional, fetchImpl }),
  };
  return runProviderToolTurn({ ...required, adapters }, {
    ...(baseUrl !== undefined ? { baseUrl } : {}), ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(maxToolTurns !== undefined ? { maxToolTurns } : {}), ...(signal !== undefined ? { signal } : {}),
  });
}
