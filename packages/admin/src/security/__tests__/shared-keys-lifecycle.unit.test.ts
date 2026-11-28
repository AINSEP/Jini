import { describe, expect, it, vi } from 'vitest';
import type { AdminCredentialCopyResult, AdminCredentialCopySource } from '@jini-ai/core/contracts/site/api-security-api-types';
import { createSharedKeysController, SHARED_KEYS_SOURCE } from '../controllers/shared-keys.controller.js';
import type { SharedKeysPort } from '../ports.js';

const WRITE = ['custom-credentials.write'];
const shared: AdminCredentialCopySource = { siteId: SHARED_KEYS_SOURCE, name: 'Shared Keys', keys: [{ kind: 'custom', id: 'k1', label: 'Metrics', provider: 'metrics', last4: 'ab12' }] };
const granted: AdminCredentialCopyResult[] = [{ kind: 'custom', id: 'k1', status: 'granted' }];

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createSharedKeysController lifecycle (SEC-12)', () => {
  it('shows no source when the read has no Shared Keys group', async () => {
    const other: AdminCredentialCopySource = { siteId: 'blog', name: 'Blog', keys: shared.keys };
    const controller = createSharedKeysController({ port: { list: vi.fn(async () => [other]), grant: vi.fn() }, permissions: WRITE });
    await controller.open({});
    expect(controller.getSnapshot()).toMatchObject({ open: true, loading: false, source: null, failure: null });
    controller.select({ id: 'k1' });
    expect(controller.grantable({})).toBeUndefined();
  });

  it('closing drops a read still in flight, whether it later succeeds or fails', async () => {
    const reads = [deferred<readonly AdminCredentialCopySource[]>(), deferred<readonly AdminCredentialCopySource[]>()];
    let call = 0;
    const port: SharedKeysPort = { list: vi.fn(() => reads[call++]!.promise), grant: vi.fn() };
    const controller = createSharedKeysController({ port, permissions: WRITE });
    const first = controller.open({});
    controller.close({});
    expect(controller.getSnapshot().open).toBe(false);
    reads[0]!.resolve([shared]); await first;
    expect(controller.getSnapshot().source).toBeNull();

    const second = controller.open({});
    expect(controller.getSnapshot()).toMatchObject({ open: true, loading: true });
    controller.close({});
    reads[1]!.reject(new Error('gone')); await second;
    expect(controller.getSnapshot()).toMatchObject({ open: false, failure: null, source: null });
  });

  it('keeps the dialog open and the selection fixed while a grant is in flight', async () => {
    const pending = deferred<readonly AdminCredentialCopyResult[]>();
    const port: SharedKeysPort = { list: vi.fn(async () => [shared]), grant: vi.fn(() => pending.promise) };
    const controller = createSharedKeysController({ port, permissions: WRITE });
    await controller.open({}); controller.select({ id: 'k1' });
    const grant = controller.grant({});
    controller.close({});
    controller.select({ id: 'other' });
    expect(controller.getSnapshot()).toMatchObject({ open: true, pending: true, selectedId: 'k1' });
    pending.resolve(granted);
    // No onGranted was given: the grant still lands and its results render.
    expect(await grant).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ open: true, pending: false, results: granted });
    controller.close({});
    expect(controller.getSnapshot().open).toBe(false);
  });

  it('a disposed controller neither opens nor grants', async () => {
    const port: SharedKeysPort = { list: vi.fn(async () => [shared]), grant: vi.fn(async () => granted) };
    const controller = createSharedKeysController({ port, permissions: WRITE });
    await controller.open({}); controller.select({ id: 'k1' });
    controller.dispose({});
    await controller.open({});
    expect(await controller.grant({})).toBe(false);
    expect(port.list).toHaveBeenCalledTimes(1);
    expect(port.grant).not.toHaveBeenCalled();
  });
});
