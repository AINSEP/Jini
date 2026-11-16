import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createMessageRelayClaimHandler } from '../message-relay.js';
import { requireRemoteToolBridgeToken } from '../remote-run-events.js';
import { requireToolExecutionCaller } from '../tool-execution-routes.js';

/**
 * Characterization of the three bearer gates the daemon's route groups mount, pinned through the public
 * gate factories before their helpers move off http-kit: the token comparison, the loopback-peer check and
 * the Authorization grammar must keep refusing exactly what they refuse today.
 */
const TOKEN = 'correct-horse-battery-staple';
const SAME_LENGTH_WRONG = 'correct-horse-battery-stapl3';

function request(overrides: { readonly authorization?: string; readonly remoteAddress?: string | undefined } = {}): Request {
  const headers: Record<string, string | undefined> = { authorization: overrides.authorization };
  const socket = 'remoteAddress' in overrides ? { remoteAddress: overrides.remoteAddress } : { remoteAddress: '127.0.0.1' };
  return { socket, get: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

function run(gate: (req: Request, res: Response, next: NextFunction) => void, req: Request) {
  const sent: { status?: number; body?: { error: { code: string } } } = {};
  const res = { status(code: number) { sent.status = code; return { json(body: { error: { code: string } }) { sent.body = body; } }; } } as unknown as Response;
  const next = vi.fn();
  gate(req, res, next);
  return { sent, next };
}

describe('requireToolExecutionCaller', () => {
  const env = { JINI_TOOL_EXEC_TOKEN: TOKEN };
  const gate = requireToolExecutionCaller({}, { env });

  it('admits a loopback caller presenting the exact token', () => {
    const { next, sent } = run(gate, request({ authorization: `Bearer ${TOKEN}` }));
    expect([next.mock.calls.length, sent.status]).toEqual([1, undefined]);
  });
  it('refuses a same-length wrong token', () => {
    const { next, sent } = run(gate, request({ authorization: `Bearer ${SAME_LENGTH_WRONG}` }));
    expect([next.mock.calls.length, sent.status, sent.body?.error.code]).toEqual([0, 401, 'UNAUTHORIZED']);
  });
  it('refuses a token of another length, and a prefix of the right one', () => {
    expect(run(gate, request({ authorization: `Bearer ${TOKEN}x` })).sent.status).toBe(401);
    expect(run(gate, request({ authorization: `Bearer ${TOKEN.slice(0, -1)}` })).sent.status).toBe(401);
  });
  it('refuses a missing or malformed Authorization header', () => {
    expect(run(gate, request()).sent.status).toBe(401);
    expect(run(gate, request({ authorization: TOKEN })).sent.status).toBe(401);
    expect(run(gate, request({ authorization: `Basic ${TOKEN}` })).sent.status).toBe(401);
  });
  it('accepts the Bearer scheme in any letter case; the token itself stays case-sensitive', () => {
    expect(run(gate, request({ authorization: `bEaReR ${TOKEN}` })).next).toHaveBeenCalledOnce();
    expect(run(gate, request({ authorization: `Bearer ${TOKEN.toUpperCase()}` })).sent.status).toBe(401);
  });
  it('refuses a non-loopback peer even with the right token, and a peer with no address', () => {
    const wrongPeer = run(gate, request({ authorization: `Bearer ${TOKEN}`, remoteAddress: '10.0.0.5' }));
    expect([wrongPeer.next.mock.calls.length, wrongPeer.sent.status, wrongPeer.sent.body?.error.code]).toEqual([0, 403, 'FORBIDDEN']);
    expect(run(gate, request({ authorization: `Bearer ${TOKEN}`, remoteAddress: undefined })).sent.status).toBe(403);
  });
  it('treats IPv4-mapped and IPv6 loopback peers as loopback and look-alike addresses as not', () => {
    for (const address of ['::ffff:127.0.0.1', '::1', '127.8.9.10']) {
      expect(run(gate, request({ authorization: `Bearer ${TOKEN}`, remoteAddress: address })).next).toHaveBeenCalledOnce();
    }
    for (const address of ['127.0.0.1.evil.example', '1270.0.0.1', '::ffff:10.0.0.1', '0127.0.0.1']) {
      expect(run(gate, request({ authorization: `Bearer ${TOKEN}`, remoteAddress: address })).sent.status).toBe(403);
    }
  });
  it('fails closed when no token is configured', () => {
    const unconfigured = run(requireToolExecutionCaller({}, { env: {} }), request({ authorization: `Bearer ${TOKEN}` }));
    expect([unconfigured.next.mock.calls.length, unconfigured.sent.body?.error.code]).toEqual([0, 'NOT_CONFIGURED']);
  });
});

describe('requireRemoteToolBridgeToken', () => {
  const gate = requireRemoteToolBridgeToken({}, { env: { JINI_REMOTE_TOOL_BRIDGE_TOKEN: TOKEN } });

  it('admits the exact token', () => {
    expect(run(gate, request({ authorization: `Bearer ${TOKEN}` })).next).toHaveBeenCalledOnce();
  });
  it('refuses a same-length wrong token, another length, a missing header and a wrong scheme', () => {
    for (const authorization of [`Bearer ${SAME_LENGTH_WRONG}`, `Bearer ${TOKEN}x`, undefined, `Basic ${TOKEN}`]) {
      const { next, sent } = run(gate, request(authorization === undefined ? {} : { authorization }));
      expect([next.mock.calls.length, sent.status, sent.body?.error.code]).toEqual([0, 401, 'REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED']);
    }
  });
  it('has no loopback exemption: a loopback peer with the wrong token is still refused', () => {
    expect(run(gate, request({ authorization: `Bearer ${SAME_LENGTH_WRONG}`, remoteAddress: '127.0.0.1' })).sent.status).toBe(401);
  });
  it('fails closed with its own code when no token is configured', () => {
    const { next, sent } = run(requireRemoteToolBridgeToken({}, { env: {} }), request({ authorization: `Bearer ${TOKEN}` }));
    expect([next.mock.calls.length, sent.body?.error.code]).toEqual([0, 'REMOTE_TOOL_BRIDGE_NOT_CONFIGURED']);
  });
});

describe('createMessageRelayClaimHandler bearer parsing', () => {
  const claim = vi.fn(() => []);
  const handler = createMessageRelayClaimHandler({
    agentExecutor: { claimUserMessages: claim },
    runScopedCallers: { resolveCaller: ({ token }) => (token === TOKEN ? { runId: 'run-1', principalId: 'p-1' } : undefined) },
  });
  function call(authorization: string | undefined) {
    const sent: { status?: number } = {};
    const res = { status(code: number) { sent.status = code; return { json: () => undefined }; }, json: () => undefined } as unknown as Response;
    const req = { ...request(authorization === undefined ? {} : { authorization }), params: { runId: 'run-1' }, body: { via: 'check_messages' } } as unknown as Request;
    handler(req, res, vi.fn());
    return sent.status;
  }
  it('resolves the caller only from a well-formed Bearer header with the exact token', () => {
    claim.mockClear();
    expect(call(`Bearer ${TOKEN}`)).toBeUndefined();
    expect(claim).toHaveBeenCalledOnce();
    for (const authorization of [undefined, TOKEN, `Basic ${TOKEN}`, `Bearer ${TOKEN} extra`, `Bearer ${SAME_LENGTH_WRONG}`]) {
      expect(call(authorization)).toBe(401);
    }
    expect(claim).toHaveBeenCalledOnce();
  });
});
