import { describe, expect, it } from 'vitest';
import { createLocalSameOriginPolicy } from '@jini-ai/core/contracts/server';
import { allowAllOrigins, createRecordingOriginPolicy, denyAllOrigins } from '@jini-ai/core/contracts/server/testing';
import { passesSameOriginGuard } from '../origin.js';

// `guardSameOrigin` itself lives in (and is tested by) @jini-ai/core; this covers the raw-route wrapper
// over the real guard, driven by an injected origin policy rather than a mock of core's internals.
const config = { allowedOriginsEnvVar: 'JINI_ALLOWED_ORIGINS', webPortEnvVar: 'JINI_WEB_PORT', bindHostEnvVar: 'JINI_BIND_HOST' };
const localOrigin = (env: Record<string, string | undefined> = {}) => ({ originPolicy: createLocalSameOriginPolicy({ port: () => 7456, env, config }) });

function recordingRes() {
  const sent: { status?: number; body?: unknown } = {};
  return { sent, res: { status(code: number) { sent.status = code; return { json(value: unknown) { sent.body = value; } }; } } };
}

describe('passesSameOriginGuard', () => {
  it('writes a forbidden envelope through a framework-neutral response port', () => {
    const { sent, res } = recordingRes();
    expect(passesSameOriginGuard({ req: { headers: { host: '127.0.0.1:7456', origin: 'https://foreign.example' } }, res, origin: localOrigin() })).toBe(false);
    expect(sent.status).toBe(403);
    expect(sent.body).toEqual({ error: { code: 'FORBIDDEN', message: 'cross-origin request rejected' } });
  });

  it('answers 403 whenever the injected policy refuses, whatever the headers say', () => {
    const { sent, res } = recordingRes();
    const req = { headers: { host: '127.0.0.1:7456', origin: 'http://127.0.0.1:7456' } };
    expect(passesSameOriginGuard({ req, res, origin: { originPolicy: denyAllOrigins } })).toBe(false);
    expect(sent.status).toBe(403);
  });

  it('lets a same-origin request through without writing a response', () => {
    const { sent, res } = recordingRes();
    expect(passesSameOriginGuard({ req: { headers: { host: '127.0.0.1:7456', origin: 'http://127.0.0.1:7456' } }, res, origin: localOrigin() })).toBe(true);
    expect(sent).toEqual({});
  });

  it('asks the injected policy exactly once, with the request it was given', () => {
    const { res } = recordingRes();
    const recording = createRecordingOriginPolicy();
    const req = { headers: { host: 'h' } };
    expect(passesSameOriginGuard({ req, res, origin: { originPolicy: recording } })).toBe(true);
    expect(passesSameOriginGuard({ req, res, origin: { originPolicy: allowAllOrigins } })).toBe(true);
    expect(recording.calls).toEqual([req]);
  });

  it("honours the env the host injected into the policy, not the real process env", () => {
    const { res } = recordingRes();
    const req = { headers: { host: 'proxy.internal:7456', origin: 'https://ok.example' } };
    expect(passesSameOriginGuard({ req, res, origin: localOrigin() })).toBe(false);
    expect(passesSameOriginGuard({ req, res, origin: localOrigin({ JINI_ALLOWED_ORIGINS: 'https://ok.example' }) })).toBe(true);
  });
});
