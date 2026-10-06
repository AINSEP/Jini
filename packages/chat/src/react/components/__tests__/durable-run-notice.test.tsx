import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MessageRow } from '../MessageRow.js';

it('renders the incident partial output and exactly one failure notice', () => {
  const partial = 'Need a repo-creation tool. Check the github plugin skill and capabilities.\n\nCreating the repo via the saved `github` credential.\n\nRepo created (private, `main`). Now the backup plan.';
  const view = render(<MessageRow message={{ id: 'm', role: 'assistant', content: partial, runStatus: 'failed', events: [{ kind: 'text', text: partial }, { kind: 'status', code: 'run_terminal', label: 'Stopped. Saved work is above.' }] }} />);
  expect(view.container.textContent).toContain('Now the backup plan.');
  expect(screen.getAllByText('Stopped. Saved work is above.')).toHaveLength(1);
  expect(screen.queryByText('This turn failed.')).toBeNull();
});
