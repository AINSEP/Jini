import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AgentRuntimePicker } from '../../components/AgentRuntimePicker.js';
import { I18nContext } from '../../../../hooks/context.js';

// Owner 2026-10-30: the full-access note was a whole paragraph beside the model picker, squeezing the
// composer row. It is now a warning icon whose tip (hover, focus, tap) carries the same text.
const note = 'Full access to this computer.';
const agents = [
  { id: 'antigravity', name: 'Antigravity', available: true, fullCliAccessOnly: true, fullCliAccessNote: note },
  { id: 'claude', name: 'Claude', available: true },
];

/** Every element holding the note's text; none may be visible until its tip opens. */
function visibleNoteCopies(): HTMLElement[] {
  return screen.queryAllByText(note).filter((el) => !el.closest('[hidden]') && !el.closest('[aria-hidden="true"]'));
}

it('shows a warning icon, not the note paragraph, in the composer row', async () => {
  const user = userEvent.setup();
  render(<AgentRuntimePicker agents={agents} value={{ agentId: 'antigravity' }} onChange={vi.fn()} />);
  expect(visibleNoteCopies()).toHaveLength(0);
  const icon = screen.getByRole('button', { name: 'Full computer access' });
  expect(icon).toHaveAccessibleDescription(note);
  await user.hover(icon);
  expect(document.querySelector('.info-tip-bubble')).toHaveTextContent(note);
});

it('opens the tip on tap and keyboard focus', async () => {
  const user = userEvent.setup();
  render(<AgentRuntimePicker agents={agents} value={{ agentId: 'antigravity' }} onChange={vi.fn()} />);
  const icon = screen.getByRole('button', { name: 'Full computer access' });
  await user.pointer({ keys: '[TouchA]', target: icon });
  expect(icon).toHaveAttribute('aria-expanded', 'true');
  await user.pointer({ keys: '[TouchA]', target: icon });
  expect(icon).toHaveAttribute('aria-expanded', 'false');
  act(() => icon.blur());
  act(() => icon.focus());
  expect(icon).toHaveAttribute('aria-expanded', 'true');
});

it('marks the agent in the picker list with the same icon, outside its radio', async () => {
  const user = userEvent.setup();
  render(<AgentRuntimePicker agents={agents} value={{ agentId: 'claude' }} onChange={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Full computer access' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
  const radio = screen.getByRole('radio', { name: /Antigravity/ });
  expect(radio).not.toHaveTextContent(note);
  expect(radio).toHaveAccessibleDescription(note);
  expect(within(radio).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Full computer access' })).toHaveAccessibleDescription(note);
  expect(visibleNoteCopies()).toHaveLength(0);
});

it('translates the note and the icon name through t()', () => {
  const t = (key: string) => `tr: ${key}`;
  render(<I18nContext.Provider value={{ t, locale: 'test' }}>
    <AgentRuntimePicker agents={agents} value={{ agentId: 'antigravity' }} onChange={vi.fn()} />
  </I18nContext.Provider>);
  expect(screen.getByRole('button', { name: 'tr: Full computer access' })).toHaveAccessibleDescription(`tr: ${note}`);
});
