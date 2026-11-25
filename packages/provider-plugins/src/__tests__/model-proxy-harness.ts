/**
 * @file Drives one `/api/proxy/*` provider registration the way the daemon's generic route does (parse, then run with the
 * host-bound runners and the shared transport options), without the daemon: the origin gate, SSE transport and error
 * redaction are the daemon's own behaviour and stay tested there. The recording `res` mirrors what that route writes
 * (status, content type, one frame per event, end), so a registration's tests assert on the same observable shape.
 */
import { vi } from 'vitest';
import { runAnthropicToolTurn, runAzureToolTurn, runGoogleToolTurn, runOllamaToolTurn, runOpenAiToolTurn } from '@jini-ai/agent-runtime';
import type { ProxyProviderRegistration } from '@jini-ai/core/contracts/agents/proxy-provider';

/** The real provider tool-turn runners, bound the way the host binds them (the transport is still faked through `fetchImpl`). */
const toolTurns = { anthropic: runAnthropicToolTurn, openai: runOpenAiToolTurn, azure: runAzureToolTurn, google: runGoogleToolTurn, ollama: runOllamaToolTurn };

export const injectedFetch = vi.fn();

// The transport is fake, but the real SSRF guard still resolves hostnames before invoking it.
// Supply a fixed public address through the DNS port so tests exercise the provider path without
// resolver traffic; a DNS failure now correctly fails closed instead of reaching the transport.
export const injectedDnsLookup = async (_args: { hostname: string }) => [{ address: '8.8.8.8', family: 4 }];

export function makeReq(body: unknown) {
  return { body };
}

export function makeSseRes() {
  const res: any = {
    write: vi.fn((_chunk: string) => true),
    status: vi.fn().mockReturnThis(),
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn(() => {
      res.writableEnded = true;
    }),
    json: vi.fn().mockReturnThis(),
    writableEnded: false,
  };
  return res;
}

/** Every SSE `data:` line's JSON payload, in write order, for a mocked `res.write`. */
export function writtenEvents(res: ReturnType<typeof makeSseRes>): Array<{ kind: string; data: unknown }> {
  return res.write.mock.calls.map(([chunk]: [string]) => {
    const dataLine = chunk.split('\n').find((line: string) => line.startsWith('data: '))!;
    const parsed = JSON.parse(dataLine.slice('data: '.length));
    return { kind: parsed.kind, data: parsed.data };
  });
}

export function sseBody(...lines: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const line of lines) yield line;
    },
  };
}

export function okResponse(body: AsyncIterable<string>) {
  return { ok: true, status: 200, body, text: async () => '' };
}

/**
 * Parses the request with the registration; a parse failure answers 400 + the error, otherwise the turn runs
 * and each event is written as one frame. `deps['<id>ExecuteTool']` is the host-owned tool executor, forwarded
 * the way the daemon forwards it (a one-argument wrapper).
 */
export function mountRegistration({ registration, deps }: { readonly registration: ProxyProviderRegistration<any>; readonly deps: Readonly<Record<string, unknown>> }) {
  const executeToolOption = deps[`${registration.id}ExecuteTool`] as ((call: unknown) => Promise<unknown>) | undefined;
  return async (req: { body: unknown }, res: ReturnType<typeof makeSseRes>): Promise<void> => {
    const parsed = registration.parse(req.body);
    if (!parsed.ok) {
      res.status(400);
      res.json({ error: parsed.error });
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    await registration.run(parsed.value, {
      toolTurns,
      onEvent: (event) => { res.write(`event: ${event.type}\ndata: ${JSON.stringify({ kind: event.type, data: event })}\n\n`); },
      shared: {
        fetchImpl: injectedFetch,
        dnsLookup: injectedDnsLookup,
        ...(executeToolOption ? { executeTool: (call: unknown): Promise<unknown> => executeToolOption(call) } : {}),
      },
    });
    res.end();
  };
}
