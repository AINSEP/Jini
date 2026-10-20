import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ModelProbeError,
  ProbeTimeout,
  concreteModelOptions,
  modelIdentityKind,
  normalizeDiscoveredModels,
  withModelProbeTimeout,
} from '../model-discovery-shared.js';

describe('modelIdentityKind', () => {
  it.each(['default', 'AUTO', 'provider/smart', 'grok-build'])('classifies routing token %s as routing-mode', (id) => {
    expect(modelIdentityKind(id)).toBe('routing-mode');
  });

  it('classifies a *-gateway id as routing-mode', () => {
    expect(modelIdentityKind('acme-gateway')).toBe('routing-mode');
  });

  it.each(['opus', 'provider/gpt', 'sonnet[1m]', 'model-latest'])('classifies alias %s as alias', (id) => {
    expect(modelIdentityKind(id)).toBe('alias');
  });

  it('classifies anything else as concrete', () => {
    expect(modelIdentityKind('provider/model-1.2')).toBe('concrete');
  });
});

describe('normalizeDiscoveredModels', () => {
  it('drops empty, "default" and duplicate ids, keeping first occurrence order', () => {
    const rows = normalizeDiscoveredModels([
      { id: '', label: 'empty' },
      { id: 'default', label: 'Default' },
      { id: 'm-1', label: 'first' },
      { id: 'm-1', label: 'second' },
      { id: 'auto', label: 'Auto' },
    ]);
    expect(rows).toEqual([
      { id: 'm-1', label: 'first', identityKind: 'concrete' },
      { id: 'auto', label: 'Auto', identityKind: 'routing-mode' },
    ]);
  });

  it('keeps a provided identityKind and a truthy resolvedId', () => {
    expect(normalizeDiscoveredModels([{ id: 'opus', label: 'Opus', identityKind: 'concrete', resolvedId: 'claude-x' }])).toEqual([
      { id: 'opus', label: 'Opus', identityKind: 'concrete', resolvedId: 'claude-x' },
    ]);
  });

  it('passes an empty resolvedId through from the row unchanged', () => {
    expect(normalizeDiscoveredModels([{ id: 'opus', label: 'Opus', resolvedId: '' }])).toEqual([
      { id: 'opus', label: 'Opus', identityKind: 'alias', resolvedId: '' },
    ]);
  });
});

describe('concreteModelOptions', () => {
  it('returns nothing when the agent cannot pin a concrete model', () => {
    expect(concreteModelOptions({ models: [{ id: 'm-1', label: 'M' }], supportsConcreteModelSelection: false })).toEqual([]);
  });

  it('defaults models to an empty list', () => {
    expect(concreteModelOptions({})).toEqual([]);
  });

  it('uses resolvedId for aliases and drops unresolved aliases and routing modes', () => {
    expect(concreteModelOptions({ models: [
      { id: 'opus', label: 'Opus', identityKind: 'alias', resolvedId: 'claude-x' },
      { id: 'sonnet', label: 'Sonnet', identityKind: 'alias' },
      { id: 'auto', label: 'Auto', identityKind: 'routing-mode' },
      { id: 'latest', label: 'Latest' },
    ] })).toEqual([{ id: 'claude-x', label: 'Opus', identityKind: 'concrete', resolvedId: 'claude-x' }]);
  });

  it('drops a resolvedId that is itself not concrete', () => {
    expect(concreteModelOptions({ models: [{ id: 'x', label: 'X', resolvedId: 'auto' }] })).toEqual([]);
  });

  it('keeps other row fields and forces identityKind to concrete', () => {
    const reasoning = [{ id: 'high', label: 'High' }];
    expect(concreteModelOptions({ models: [{ id: 'm-1', label: 'M', reasoning }] })).toEqual([{ id: 'm-1', label: 'M', reasoning, identityKind: 'concrete' }]);
  });

  it('replaces a default-policy label with the concrete id', () => {
    expect(concreteModelOptions({ models: [
      { id: 'default', label: 'Whatever', resolvedId: 'm-1' },
      { id: 'm-2', label: 'Default (CLI config)' },
    ] }).map(row => row.label)).toEqual(['m-1', 'm-2']);
  });

  it('upgrades a raw-id label from a later duplicate but never overwrites a real label', () => {
    expect(concreteModelOptions({ models: [
      { id: 'default', label: 'Default', resolvedId: 'm-1' },
      { id: 'm-1', label: 'Model One' },
      { id: 'm-2', label: 'Model Two' },
      { id: 'm-2', label: 'Other' },
      { id: 'm-3', label: 'm-3' },
      { id: 'm-3', label: 'm-3' },
    ] }).map(row => [row.id, row.label])).toEqual([['m-1', 'Model One'], ['m-2', 'Model Two'], ['m-3', 'm-3']]);
  });

  it('prepends a resolved concrete default that is missing from the catalog', () => {
    expect(concreteModelOptions({ models: [{ id: 'm-1', label: 'M' }], defaultModelResolution: { status: 'resolved', id: 'hidden-1' } }).map(row => row.id)).toEqual(['hidden-1', 'm-1']);
  });

  it('does not duplicate a resolved default already in the catalog', () => {
    expect(concreteModelOptions({ models: [{ id: 'm-1', label: 'M' }], defaultModelResolution: { status: 'resolved', id: 'm-1' } }).map(row => row.id)).toEqual(['m-1']);
  });

  it.each([
    { status: 'resolved', id: 'opus' },
    { status: 'resolved' },
    { status: 'unresolved', id: 'hidden-1' },
  ])('does not prepend a non-concrete, id-less or unresolved default (%o)', (defaultModelResolution) => {
    expect(concreteModelOptions({ models: [], defaultModelResolution })).toEqual([]);
  });
});

describe('withModelProbeTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the work result and leaves no timer behind', async () => {
    vi.useFakeTimers();
    await expect(withModelProbeTimeout(async () => 'value', 1000)).resolves.toBe('value');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates the work rejection unchanged', async () => {
    const failure = new Error('work failed');
    await expect(withModelProbeTimeout(async () => { throw failure; }, 1000)).rejects.toBe(failure);
  });

  it('cancels with ProbeTimeout("Probe cancelled") and aborts the work signal when the parent aborts mid-flight', async () => {
    const parent = new AbortController();
    let workSignal: AbortSignal | undefined;
    const pending = withModelProbeTimeout((signal) => { workSignal = signal; return new Promise<never>(() => {}); }, 60_000, parent.signal);
    parent.abort();
    await expect(pending).rejects.toThrow(new ProbeTimeout('Probe cancelled'));
    expect(workSignal?.aborted).toBe(true);
  });

  it('never starts the work when the parent signal is already aborted', async () => {
    const parent = new AbortController();
    parent.abort();
    const work = vi.fn(async () => 1);
    await expect(withModelProbeTimeout(work, 1000, parent.signal)).rejects.toThrow(new ProbeTimeout('Probe cancelled'));
    expect(work).not.toHaveBeenCalled();
  });

  it('rejects with a ProbeTimeout instance on timeout', async () => {
    await expect(withModelProbeTimeout(() => new Promise<never>(() => {}), 1)).rejects.toBeInstanceOf(ProbeTimeout);
  });

  it('detaches its parent abort listener once the work settles', async () => {
    const parent = new AbortController();
    const remove = vi.spyOn(parent.signal, 'removeEventListener');
    const add = vi.spyOn(parent.signal, 'addEventListener');
    await withModelProbeTimeout(async () => 1, 1000, parent.signal);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
  });
});

describe('ModelProbeError', () => {
  it('carries the diagnostic code as both code and message', () => {
    const error = new ModelProbeError('timeout');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('timeout');
    expect(error.message).toBe('timeout');
  });
});
