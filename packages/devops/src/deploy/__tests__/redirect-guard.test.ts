import { describe, expect, it } from 'vitest';
import { DeployError } from '../types.js';
import { assertNotRedirected, redirectGuardInit } from '../redirect-guard.js';

describe('redirectGuardInit', () => {
  it('adds redirect: manual without mutating the caller-supplied init object', () => {
    const original: RequestInit = { method: 'GET', headers: { Authorization: 'Bearer secret' } };
    const guarded = redirectGuardInit(original);
    expect(guarded).toEqual({ method: 'GET', headers: { Authorization: 'Bearer secret' }, redirect: 'manual' });
    expect(original).not.toHaveProperty('redirect');
  });
});

describe('assertNotRedirected', () => {
  it('throws DeployError for a 3xx status response', () => {
    const resp = new Response('', { status: 302, headers: { location: 'https://evil.example/steal-token' } });
    expect(() => assertNotRedirected(resp, 'Test provider call')).toThrow(DeployError);
    expect(() => assertNotRedirected(resp, 'Test provider call')).toThrow(/refused to follow/);
  });

  it('throws DeployError for an opaque-redirect filtered response (real redirect: manual outcome)', () => {
    // `Response`'s `type` field is normally computed internally and unassignable via the public
    // constructor — this stands in for what a real `fetch(url, { redirect: 'manual' })` call
    // resolves to on an actual 3xx (status 0, type 'opaqueredirect', per the WHATWG Fetch spec).
    const opaqueRedirect = { status: 0, type: 'opaqueredirect' } as unknown as Response;
    expect(() => assertNotRedirected(opaqueRedirect, 'Test provider call')).toThrow(DeployError);
  });

  it('does not throw for an ordinary 200 response', () => {
    const resp = new Response('{}', { status: 200 });
    expect(() => assertNotRedirected(resp, 'Test provider call')).not.toThrow();
  });

  it('does not throw for a 404 — callers rely on this status surviving the guard to branch on it', () => {
    const resp = new Response('', { status: 404 });
    expect(() => assertNotRedirected(resp, 'Test provider call')).not.toThrow();
  });
});
