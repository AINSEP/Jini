import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSourceConfigAddForm, useWiredSourceConfigAddForm } from './useSourceConfigAddForm.js';
import type { SourceConfigPort } from '../../ports.js';
import type { SourceConfigItem, SourceFieldSpec } from '../../types.js';

const URL_FIELD: SourceFieldSpec = { key: 'url', label: 'URL', kind: 'url', required: true };

function fakePort(overrides: Partial<SourceConfigPort<SourceConfigItem>> = {}): SourceConfigPort<SourceConfigItem> {
  return {
    fetchSources: vi.fn().mockResolvedValue([]),
    addSource: vi.fn().mockResolvedValue({ ok: true, source: { id: 'new', fields: { url: 'https://new.example' } } }),
    removeSource: vi.fn(),
    ...overrides,
  };
}

describe('useSourceConfigAddForm', () => {
  it('seeds an empty draft from the field specs', () => {
    const { result } = renderHook(() => useSourceConfigAddForm({ port: fakePort(), fieldSpecs: [URL_FIELD] }));
    expect(result.current.values).toEqual({ url: '' });
    expect(result.current.trust).toBeUndefined();
    expect(result.current.submitAttempted).toBe(false);
  });

  it('setField updates one value without touching others', () => {
    const specs: SourceFieldSpec[] = [URL_FIELD, { key: 'label', label: 'Label', kind: 'text' }];
    const { result } = renderHook(() => useSourceConfigAddForm({ port: fakePort(), fieldSpecs: specs }));
    act(() => result.current.setField('url', 'https://x.example'));
    expect(result.current.values).toEqual({ url: 'https://x.example', label: '' });
  });

  it('setTrust updates the trust selection', () => {
    const { result } = renderHook(() => useSourceConfigAddForm({ port: fakePort(), fieldSpecs: [URL_FIELD] }));
    act(() => result.current.setTrust('trusted'));
    expect(result.current.trust).toBe('trusted');
  });

  it('validation reflects the current draft against the field specs', () => {
    const { result } = renderHook(() => useSourceConfigAddForm({ port: fakePort(), fieldSpecs: [URL_FIELD] }));
    expect(result.current.validation.ok).toBe(false);
    act(() => result.current.setField('url', 'https://x.example'));
    expect(result.current.validation.ok).toBe(true);
  });

  it('submit marks submitAttempted and blocks when invalid, without calling the port', async () => {
    const addSource = vi.fn();
    const { result } = renderHook(() => useSourceConfigAddForm({ port: fakePort({ addSource }), fieldSpecs: [URL_FIELD] }));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.submitAttempted).toBe(true);
    expect(addSource).not.toHaveBeenCalled();
  });

  it('submit calls addSource with the fields (and trust, when set) and resets the draft on success', async () => {
    const created: SourceConfigItem = { id: 'new', fields: { url: 'https://new.example' }, trust: 'trusted' };
    const addSource = vi.fn().mockResolvedValue({ ok: true, source: created });
    const onAdded = vi.fn();
    const { result } = renderHook(() =>
      useSourceConfigAddForm({ port: fakePort({ addSource }), fieldSpecs: [URL_FIELD], onAdded }),
    );
    act(() => {
      result.current.setField('url', 'https://new.example');
      result.current.setTrust('trusted');
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(addSource).toHaveBeenCalledWith({ fields: { url: 'https://new.example' }, trust: 'trusted' });
    expect(onAdded).toHaveBeenCalledWith(created);
    expect(result.current.values).toEqual({ url: '' });
    expect(result.current.trust).toBeUndefined();
    expect(result.current.submitAttempted).toBe(false);
    expect(result.current.submitting).toBe(false);
  });

  it('submit omits trust from the port call when unset', async () => {
    const addSource = vi.fn().mockResolvedValue({ ok: true, source: { id: 'new', fields: { url: 'https://new.example' } } });
    const { result } = renderHook(() => useSourceConfigAddForm({ port: fakePort({ addSource }), fieldSpecs: [URL_FIELD] }));
    act(() => result.current.setField('url', 'https://new.example'));
    await act(async () => {
      await result.current.submit();
    });
    expect(addSource).toHaveBeenCalledWith({ fields: { url: 'https://new.example' } });
  });

  it('submit records a submitError and keeps the draft when the port reports failure', async () => {
    const addSource = vi.fn().mockResolvedValue({ ok: false, message: 'Marketplace unreachable.' });
    const { result } = renderHook(() => useSourceConfigAddForm({ port: fakePort({ addSource }), fieldSpecs: [URL_FIELD] }));
    act(() => result.current.setField('url', 'https://new.example'));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.submitError).toBe('Marketplace unreachable.');
    expect(result.current.values).toEqual({ url: 'https://new.example' });
    expect(result.current.submitting).toBe(false);
  });

  it('falls back to a default submitError message when the port omits one', async () => {
    const addSource = vi.fn().mockResolvedValue({ ok: false });
    const { result } = renderHook(() => useSourceConfigAddForm({ port: fakePort({ addSource }), fieldSpecs: [URL_FIELD] }));
    act(() => result.current.setField('url', 'https://new.example'));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.submitError).toBe('Failed to add source.');
  });
});

describe('useWiredSourceConfigAddForm', () => {
  it('binds the port from dependencies', async () => {
    const created: SourceConfigItem = { id: 'new', fields: { url: 'https://new.example' } };
    const addSource = vi.fn().mockResolvedValue({ ok: true, source: created });
    const { result } = renderHook(() =>
      useWiredSourceConfigAddForm({ dependencies: { port: fakePort({ addSource }) }, fieldSpecs: [URL_FIELD] }),
    );
    act(() => result.current.setField('url', 'https://new.example'));
    await act(async () => {
      await result.current.submit();
    });
    expect(addSource).toHaveBeenCalledWith({ fields: { url: 'https://new.example' } });
  });
});
