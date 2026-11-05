import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignInHandoffs, waitForHostedSignIn } from '../hosted-sign-in.js';
import type { ApiConnectionStatusView } from '../status.js';

const view = (status: ApiConnectionStatusView['status']): ApiConnectionStatusView => ({
  status, connectionRef: 'neutral-ref', account: null, grantedScopes: [], pendingSwitch: null, revocationFailure: null,
});

function watch() {
  const controller = new AbortController();
  const getStatus = vi.fn(async () => view('connected'));
  const readGeneration = vi.fn(async () => 5);
  return { controller, getStatus, readGeneration, required: {
    workspaceId: 'neutral-workspace', connectionRef: 'neutral-ref', startGeneration: 5,
    getStatus, readGeneration, signal: controller.signal, pollIntervalMs: 10, waitTimeoutMs: 25,
  } };
}

afterEach(() => vi.useRealTimers());

describe('waitForHostedSignIn', () => {
  it('requires connected status and a generation strictly newer than the baseline', async () => {
    vi.useFakeTimers();
    const { required, getStatus, readGeneration } = watch();
    getStatus.mockResolvedValueOnce(view('disconnected'));
    readGeneration.mockResolvedValueOnce(5).mockResolvedValueOnce(6);
    const result = waitForHostedSignIn(required);
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toBe(true);
    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(getStatus).toHaveBeenCalledWith({ connectionRef: 'neutral-ref', workspaceId: 'neutral-workspace' });
    expect(readGeneration).toHaveBeenCalledTimes(2);
    expect(readGeneration).toHaveBeenCalledWith({ key: 'neutral-ref' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never reads generation for a disconnected record, even when a newer generation exists', async () => {
    vi.useFakeTimers();
    const { required, getStatus, readGeneration } = watch();
    getStatus.mockResolvedValue(view('disconnected'));
    readGeneration.mockResolvedValue(6);
    const result = waitForHostedSignIn(required);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toBe(false);
    expect(readGeneration).not.toHaveBeenCalled();
  });

  it('does not accept an unchanged generation and caps the final pause at the deadline', async () => {
    vi.useFakeTimers();
    const { required, getStatus } = watch();
    const result = waitForHostedSignIn({ ...required, pollIntervalMs: 20 });
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toBe(false);
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a sleeping poll promptly and clears its timer', async () => {
    vi.useFakeTimers();
    const { required, controller, getStatus } = watch();
    const result = waitForHostedSignIn({ ...required, waitTimeoutMs: 100_000, pollIntervalMs: 50_000 });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await result).toBe(false);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not poll an already aborted or timed-out wait', async () => {
    const { required, controller, getStatus } = watch();
    controller.abort();
    expect(await waitForHostedSignIn(required)).toBe(false);
    expect(await waitForHostedSignIn({ ...required, signal: new AbortController().signal, waitTimeoutMs: 0 })).toBe(false);
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('propagates status and generation reader errors unchanged', async () => {
    const { required, getStatus, readGeneration } = watch();
    const failure = new Error('reader failed');
    getStatus.mockRejectedValueOnce(failure);
    await expect(waitForHostedSignIn(required)).rejects.toBe(failure);
    readGeneration.mockRejectedValueOnce(failure);
    await expect(waitForHostedSignIn(required)).rejects.toBe(failure);
  });
});

describe('createSignInHandoffs', () => {
  const draft = { actorId: 'neutral-actor', authorizationUrl: 'https://auth.example.test/authorize',
    browserBinding: 'b'.repeat(43), expiresAt: '2030-01-01T00:10:00.000Z' };
  const entropy = ({ byteLength }: { byteLength: number }) => randomBytes(byteLength);

  it('burns an id before checking its actor and refuses replays', () => {
    const handoffs = createSignInHandoffs({ clock: { nowMs: () => Date.parse('2030-01-01T00:00:00.000Z') }, randomBytesFn: entropy });
    const id = handoffs.issue(draft);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(handoffs.take({ handoffId: id, actorId: 'other' })).toBeNull();
    expect(handoffs.take({ handoffId: id, actorId: draft.actorId })).toBeNull();
    const valid = handoffs.issue(draft);
    expect(handoffs.take({ handoffId: valid, actorId: draft.actorId })).toEqual(draft);
    expect(handoffs.take({ handoffId: valid, actorId: draft.actorId })).toBeNull();
  });

  it('expires at the exact deadline and keeps host instances independent', () => {
    let now = Date.parse(draft.expiresAt) - 1;
    const required = { clock: { nowMs: () => now }, randomBytesFn: entropy };
    const first = createSignInHandoffs(required);
    const second = createSignInHandoffs(required);
    const live = first.issue(draft);
    expect(second.take({ handoffId: live, actorId: draft.actorId })).toBeNull();
    expect(first.take({ handoffId: live, actorId: draft.actorId })).toEqual(draft);
    const expired = first.issue(draft);
    now += 1;
    expect(first.take({ handoffId: expired, actorId: draft.actorId })).toBeNull();
  });

  it('evicts the oldest at capacity while retaining the newest', () => {
    const handoffs = createSignInHandoffs({ clock: { nowMs: () => Date.parse('2030-01-01T00:00:00.000Z') }, randomBytesFn: entropy });
    const first = handoffs.issue(draft);
    let newest = first;
    for (let i = 0; i < 256; i += 1) newest = handoffs.issue(draft);
    expect(handoffs.take({ handoffId: first, actorId: draft.actorId })).toBeNull();
    expect(handoffs.take({ handoffId: newest, actorId: draft.actorId })).toEqual(draft);
  });

  it('propagates entropy errors before issuing an id', () => {
    const failure = new Error('entropy unavailable');
    const handoffs = createSignInHandoffs({ clock: { nowMs: () => 0 }, randomBytesFn: () => { throw failure; } });
    expect(() => handoffs.issue(draft)).toThrow(failure);
  });
});
