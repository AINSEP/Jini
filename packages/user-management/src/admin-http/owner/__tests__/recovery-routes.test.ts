import { describe, expect, it } from 'vitest';
import { IdentityValidationError, OwnerRequiredError } from '../../../core/types.js';
import type { OwnerRecoveryDeps } from '../../../server/recovery-codes.js';
import { createOwnerRecoveryRoutes, type OwnerRecoveryRoute, type OwnerRecoveryRouteDeps } from '../recovery-routes.js';

const HEADER = 'x-desktop-owner-signin';
const [issueRoute, recoverRoute, resetRoute, statusRoute] = createOwnerRecoveryRoutes({ desktopCapabilityHeader: 'X-Desktop-Owner-Signin' });

type Fixture = { caller?: string | null; allowed?: boolean; json?: boolean; desktop?: boolean; local?: boolean; codes?: boolean; noDeps?: boolean; recoverError?: Error };

function fixture(options: Fixture = {}) {
  const calls: string[] = [];
  const caller = options.caller === undefined ? 'owner' : options.caller;
  const deps: OwnerRecoveryRouteDeps = {
    workspaceId: 'site',
    ownerPrincipalId: Promise.resolve('owner'),
    recoveryAvailable: options.codes ?? true,
    desktopOwnerReset: options.desktop ?? false,
    authenticate: async () => { calls.push('authenticate'); return caller ? { id: caller } : null; },
    isJsonRequest: () => options.json ?? true,
    siteOrigin: () => 'https://site.test',
    checkRateLimit: async () => { calls.push('rate'); return { allowed: options.allowed ?? true, retryAfterSeconds: 42 }; },
    isLocalRequest: () => options.local ?? false,
    acceptsDesktopCapability: ({ capability }) => capability === 'launch-proof',
    recoveryDeps: async () => {
      calls.push('deps');
      if (options.noDeps) throw new Error('Durable recovery storage is not configured password=hunter2');
      return { seededOwnerPrincipalId: 'owner' } as unknown as OwnerRecoveryDeps;
    },
    services: {
      issueRecoveryCodes: async (args) => { calls.push(`issue:${JSON.stringify(args.input)}`); return { codes: ['a', 'b'] }; },
      recoverOwner: async (args) => { calls.push(`recover:${args.input.code}`); if (options.recoverError) throw options.recoverError; },
      resetOwnerPassword: async (args) => { calls.push(`reset:${args.input.password}`); },
    },
  };
  return { deps, calls };
}

async function call(route: OwnerRecoveryRoute, deps: OwnerRecoveryRouteDeps, { headers = { origin: 'https://site.test' } as Record<string, string>, body = {} as unknown } = {}) {
  const raw = { params: {}, query: {}, body, headers } as never;
  const response = await route.handle({ raw, deps, context: undefined, authorize: (async () => undefined) as never }, { signal: new AbortController().signal });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) as Record<string, unknown> : undefined };
}

describe('owner recovery raw routes', () => {
  it('declares the four routes, no-store on every reply, and reads the injected desktop header lower-cased', () => {
    expect([issueRoute, recoverRoute, resetRoute, statusRoute].map((r) => `${r!.method} ${r!.path}`)).toEqual([
      'post /api/admin/v1/auth/recovery-codes', 'post /api/admin/v1/auth/recover-owner',
      'post /api/admin/v1/auth/reset-owner', 'get /api/admin/v1/auth/owner-recovery']);
    for (const route of [issueRoute, recoverRoute, resetRoute, statusRoute]) {
      expect(route!.responseHeaders).toEqual({ 'Cache-Control': 'no-store' });
      expect(route!.readHeaders).toEqual(['sec-fetch-site', 'origin', HEADER]);
    }
  });

  it('refuses a wrong origin, a cross-site fetch and a non-JSON body before the limiter or any code lookup', async () => {
    for (const [overrides, headers] of [[{}, { origin: 'https://attacker.test' }], [{}, { 'sec-fetch-site': 'cross-site' }], [{ json: false }, {}]] as const) {
      const f = fixture(overrides);
      const result = await call(recoverRoute!, f.deps, { headers, body: { code: 'c', password: 'private-password' } });
      expect(result.status).toBe(403);
      expect(result.body).toEqual({ error: 'Recovery requires a same-origin JSON request. Open the site sign-in page and try again.', details: { operation: 'owner-recovery-origin' } });
      expect(f.calls).toEqual([]);
    }
  });

  it('rate limited: 429 with Retry-After before deps, admission or any code lookup', async () => {
    const f = fixture({ allowed: false });
    const result = await call(recoverRoute!, f.deps, { body: { code: 'c', password: 'p' } });
    expect(result.status).toBe(429);
    expect(result.headers.get('Retry-After')).toBe('42');
    expect(result.body).toEqual({ error: 'Too many recovery attempts. Wait a minute and try again.', details: { operation: 'owner-recovery-limit' } });
    expect(f.calls).toEqual(['rate']);
  });

  it('recover needs no session; an invalid or reused code is a safe 400 refusal without request input', async () => {
    const f = fixture({ caller: null, recoverError: new IdentityValidationError({ message: 'Recovery code is not valid.' }) });
    const result = await call(recoverRoute!, f.deps, { body: { code: 'used-code', password: 'private-password' } });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Recovery code is not valid.', code: 'RECOVERY_REFUSED', details: { operation: 'owner-recovery-recover' } });
    expect(f.calls).toEqual(['rate', 'deps', 'recover:used-code']);
    const ok = fixture({ caller: null });
    expect((await call(recoverRoute!, ok.deps, { body: { code: 'fresh', password: 'new' } })).status).toBe(204);
  });

  it('missing admission: issue and reset refuse a signed-out or staff caller with 403 before any write', async () => {
    for (const caller of [null, 'staff']) {
      for (const route of [issueRoute!, resetRoute!]) {
        // A remote request: the desktop header alone (no local transport) never stands in for the owner session.
        const f = fixture({ caller, desktop: true, local: false });
        const result = await call(route, f.deps, { headers: { origin: 'https://site.test', [HEADER]: 'launch-proof' }, body: { password: 'private-password' } });
        expect(result.status).toBe(403);
        expect(result.body?.code).toBe('RECOVERY_REFUSED');
        expect(JSON.stringify(result.body)).not.toContain('private-password');
        expect(f.calls.some((c) => /^(issue|reset):/.test(c))).toBe(false);
      }
    }
  });

  it('desktop sign-in header misuse: an owner cookie cannot reset without local transport and the right proof', async () => {
    for (const [overrides, proof] of [[{ desktop: true, local: true }, undefined], [{ desktop: true, local: true }, 'wrong-proof'],
      [{ desktop: true, local: false }, 'launch-proof'], [{ desktop: false, local: true }, 'launch-proof']] as const) {
      const f = fixture(overrides);
      const result = await call(resetRoute!, f.deps, { headers: { origin: 'https://site.test', ...(proof ? { [HEADER]: proof } : {}) }, body: { password: 'new' } });
      expect(result.status).toBe(403);
      expect(f.calls.some((c) => c.startsWith('reset:'))).toBe(false);
    }
    // A host with no desktop capability verifier never admits the header, even when local.
    const unverified = fixture({ desktop: true, local: true });
    delete (unverified.deps as { acceptsDesktopCapability?: unknown }).acceptsDesktopCapability;
    expect((await call(resetRoute!, unverified.deps, { headers: { origin: 'https://site.test', [HEADER]: 'launch-proof' }, body: { password: 'new' } })).status).toBe(403);
    expect(unverified.calls.some((c) => c.startsWith('reset:'))).toBe(false);
    const proven = fixture({ caller: null, desktop: true, local: true });
    expect((await call(resetRoute!, proven.deps, { headers: { origin: 'https://site.test', [HEADER]: 'launch-proof' }, body: { password: 'new' } })).status).toBe(204);
    expect(proven.calls).toEqual(['rate', 'deps', 'reset:new']);
  });

  it('owner issues a kit (200 JSON) with only scalar body text forwarded', async () => {
    const f = fixture();
    const result = await call(issueRoute!, f.deps, { body: { password: 'pw', code: 7 } });
    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(result.body).toEqual({ codes: ['a', 'b'] });
    expect(f.calls).toEqual(['rate', 'deps', 'authenticate', 'issue:{"workspaceId":"site","principalId":"owner","password":"pw","code":""}']);
  });

  it('unexpected storage failures are a redacted 503 naming the operation, never the exception text', async () => {
    const f = fixture({ noDeps: true });
    const result = await call(recoverRoute!, f.deps, { body: { password: 'private-password' } });
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'Owner recovery could not be saved. Retry once, then ask the host operator to check the identity database.',
      code: 'RECOVERY_UNAVAILABLE', details: { operation: 'owner-recovery-recover' } });
    const owner = fixture({ recoverError: new OwnerRequiredError({ message: 'Owner only.' }) });
    expect((await call(recoverRoute!, owner.deps, { body: {} })).status).toBe(403);
  });

  it('status exposes no codes and hides owner actions from staff and signed-out callers', async () => {
    expect((await call(statusRoute!, fixture({ caller: 'staff', desktop: true }).deps)).body).toEqual({ isOwner: false, available: false, desktopOwnerReset: false });
    expect((await call(statusRoute!, fixture({ caller: null }).deps)).body).toEqual({ isOwner: false, available: false, desktopOwnerReset: false });
    expect((await call(statusRoute!, fixture({ desktop: true, codes: false }).deps)).body).toEqual({ isOwner: true, available: false, desktopOwnerReset: true });
    const broken = fixture();
    broken.deps.authenticate = async () => { throw new Error('db down'); };
    const failed = await call(statusRoute!, broken.deps);
    expect(failed.status).toBe(503);
    expect(failed.body?.details).toEqual({ operation: 'owner-recovery-issue' });
  });
});
