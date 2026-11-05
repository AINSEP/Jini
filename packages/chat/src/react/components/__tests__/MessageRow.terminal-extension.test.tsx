import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ChatMessage } from '../../../core/index.js';
import { clearExtEventRenderers, registerExtEventRenderer } from '../../ext-event-renderer-registry.js';
import { MessageRow } from '../MessageRow.js';

afterEach(() => { cleanup(); clearExtEventRenderers(); });

const failed: ChatMessage = { id: 'failed', role: 'assistant', content: 'Saved work.', runStatus: 'failed',
  events: [{ kind: 'ext', name: 'failure-card', data: { reason: 'Quota reached' } }] };
const renderer = () => <div role="status">Quota reached. Review the saved work.</div>;

it('lets a registered terminal explanation replace the generic footer while keeping the saved answer', () => {
  registerExtEventRenderer({ name: 'failure-card', renderer });
  const baseline = render(<MessageRow message={failed} />);
  expect(screen.getAllByRole('status')).toHaveLength(2);
  baseline.unmount();

  const unregister = registerExtEventRenderer({ name: 'failure-card', renderer }, {
    terminalNotice: ({ events }) => (events.at(-1) as { reason?: unknown })?.reason === 'Quota reached',
  });
  const treatment = render(<MessageRow message={failed} />);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('Quota reached. Review the saved work.');
  expect(screen.getByText('Saved work.')).toBeInTheDocument();
  treatment.unmount();
  unregister();
  render(<MessageRow message={failed} />);
  expect(screen.getByRole('status')).toHaveTextContent('This turn failed.');
});

it.each([false, 'throw'])('retains the terminal fallback when a renderer cannot own its explanation (%s)', refusal => {
  registerExtEventRenderer({ name: 'failure-card', renderer }, { terminalNotice: () => {
    if (refusal === 'throw') throw new Error('invalid extension data');
    return false;
  } });
  render(<MessageRow message={failed} />);
  expect(screen.getAllByRole('status')).toHaveLength(2);
  expect(screen.getByText('This turn failed.')).toBeInTheDocument();
});
