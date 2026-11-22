import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createConsoleLogger } from '@jini-ai/core/primitives';
import { KitProvider } from '../KitProvider.js';
import { getSharedKitContext } from '../context.js';
import { createKit } from '../kit.js';
import { ConfirmDialog } from '../confirm/ConfirmDialog.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('reports conformance through the kit port once and retains native fallback', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const report = createConsoleLogger({ prefix: '' });
  const kit = createKit({ components: { ConfirmDialog: () => <div>broken override</div> } });
  const view = render(<KitProvider kit={kit} report={report}><ConfirmDialog open title="Delete?" confirmLabel="Delete" onConfirm={() => {}} onCancel={() => {}} /></KitProvider>);
  await waitFor(() => expect(view.getByRole('alertdialog')).toBeTruthy());
  expect(error).toHaveBeenCalledTimes(1);
  expect(error.mock.calls.flat().join(' ')).toContain('ConfirmDialog conformance violation');
  expect(view.queryByText('broken override')).toBeNull();
});
it('defers skew diagnostics until a provider commits and keeps one warning per new version', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const report = createConsoleLogger({ prefix: '' });
  const context = getSharedKitContext({ version: '0.1.0' });
  expect(getSharedKitContext({ version: '0.1.0-log-safety-n' })).toBe(context);
  expect(warn).not.toHaveBeenCalled();
  const view = render(<KitProvider report={report}>{null}</KitProvider>);
  expect(warn).toHaveBeenCalledTimes(1);
  view.rerender(<KitProvider report={report}>{null}</KitProvider>);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(getSharedKitContext({ version: '0.1.0-log-safety-n-next' })).toBe(context);
  view.rerender(<KitProvider report={report}>{null}</KitProvider>);
  expect(warn).toHaveBeenCalledTimes(2);
});
