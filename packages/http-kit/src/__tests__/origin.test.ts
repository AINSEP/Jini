import { describe, expect, it } from 'vitest';
import { passesSameOriginGuard } from '../origin.js';

// `guardSameOrigin` itself lives in (and is tested by) @jini-ai/core; this covers the raw-route wrapper
// over the real guard, driven by real headers rather than a mock of core's internals.
const origin = { allowedOriginsEnvVar: 'JINI_ALLOWED_ORIGINS', webPortEnvVar: 'JINI_WEB_PORT', bindHostEnvVar: 'JINI_BIND_HOST', env: {}, resolvedPortRef: { current: 7456 } };

function recordingRes() {
  const sent: { status?: number; body?: unknown } = {};
  return { sent, res: { status(code: number) { sent.status = code; return { json(value: unknown) { sent.body = value; } }; } } };
}

describe('passesSameOriginGuard', () => {
  it('writes a forbidden envelope through a framework-neutral response port', () => {
    const { sent, res } = recordingRes();
    expect(passesSameOriginGuard({ req: { headers: { host: '127.0.0.1:7456', origin: 'https://foreign.example' } }, res, origin })).toBe(false);
    expect(sent.status).toBe(403);
    expect(sent.body).toEqual({ error: { code: 'FORBIDDEN', message: 'cross-origin request rejected' } });
  });

  it('lets a same-origin request through without writing a response', () => {
    const { sent, res } = recordingRes();
    expect(passesSameOriginGuard({ req: { headers: { host: '127.0.0.1:7456', origin: 'http://127.0.0.1:7456' } }, res, origin })).toBe(true);
    expect(sent).toEqual({});
  });

  it("honours the env the host injected into the context, not the real process env", () => {
    const { res } = recordingRes();
    const req = { headers: { host: 'proxy.internal:7456', origin: 'https://ok.example' } };
    expect(passesSameOriginGuard({ req, res, origin })).toBe(false);
    expect(passesSameOriginGuard({ req, res, origin: { ...origin, env: { JINI_ALLOWED_ORIGINS: 'https://ok.example' } } })).toBe(true);
  });
});
