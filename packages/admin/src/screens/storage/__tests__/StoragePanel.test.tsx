// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { StoragePanel } from '../StoragePanel.js';

const copy = { automatic: 'Cleaned automatically', yours: 'Yours', shown: 'Shown only', dryRun: 'Preview cleanup', confirm: 'Confirm as owner', clean: 'Clean now', lastAutomaticPass: 'Last automatic pass', freed: 'Freed', failures: 'Failures' };
it('three class labels', () => {
  render(<StoragePanel useStorage={() => ({ phase: 'load', classes: { automatic: [], yours: [], shown: [] }, outcomes: [], canConfirm: false, dryRun: vi.fn(), confirm: vi.fn(), cleanup: vi.fn() })} kit={{ Button: 'button' }} copy={copy} links={[]} />);
  expect(screen.getByRole('heading', { name: 'Cleaned automatically' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Yours' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Shown only' })).toBeTruthy();
});
it('dry-run list first', async () => {
  const calls: string[] = [];
  const useStorage = () => {
    const [phase, setPhase] = useState<'ready' | 'outcomes' | 'confirm' | 'done'>('ready');
    return { phase, classes: { automatic: [], yours: [], shown: [] }, outcomes: phase === 'ready' ? [] : [{ id: 'cache', label: 'Cache preview', outcome: '12 bytes' }], canConfirm: true,
      dryRun: () => { calls.push('dry'); setPhase('outcomes'); }, confirm: () => { calls.push('confirm'); setPhase('confirm'); }, cleanup: () => { calls.push('live'); setPhase('done'); } };
  };
  render(<StoragePanel useStorage={useStorage} kit={{ Button: 'button' }} copy={copy} links={[]} />);
  expect(screen.queryByRole('button', { name: 'Clean now' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Preview cleanup' }));
  expect(calls).toEqual(['dry']);
  expect(screen.getByText('Cache preview: 12 bytes')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm as owner' }));
  expect(calls).toEqual(['dry', 'confirm']);
  await userEvent.click(screen.getByRole('button', { name: 'Clean now' }));
  expect(calls).toEqual(['dry', 'confirm', 'live']);
});
