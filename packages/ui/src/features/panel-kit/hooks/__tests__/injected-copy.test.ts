import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDirtyGuard } from '../use-dirty-guard.hooks.js';
afterEach(() => vi.restoreAllMocks());
it('translates the unsaved-change prompt through the caller function', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { result } = renderHook(() => useDirtyGuard({ current: { name: 'new' }, original: { name: 'old' } }, { translate: () => 'Quitter sans enregistrer ?' }));
  expect(result.current.confirmLeave()).toBe(false);
  expect(confirm).toHaveBeenCalledWith('Quitter sans enregistrer ?');
});
