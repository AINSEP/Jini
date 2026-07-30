import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NextStepActions } from '../NextStepActions.js';
import { I18nContext } from '../../hooks/context.js';

const actions = [
  { id: 'continue', label: 'Continue' },
  { id: 'generate', label: 'Generate artifact', description: 'Create the missing deliverable' },
];

describe('NextStepActions', () => {
  it('renders nothing for an empty action list', () => {
    const { container } = render(<NextStepActions actions={[]} onSelect={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders every action with its label/description and calls onSelect with the id', async () => {
    const onSelect = vi.fn();
    render(<NextStepActions actions={actions} onSelect={onSelect} />);
    expect(screen.getByText('Continue')).toBeInTheDocument();
    expect(screen.getByText('Generate artifact')).toBeInTheDocument();
    expect(screen.getByText('Create the missing deliverable')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Continue'));
    expect(onSelect).toHaveBeenCalledWith('continue');
  });

  it('renders an action icon when provided', () => {
    render(<NextStepActions actions={[{ id: 'a', label: 'Refine', icon: <svg data-testid="refine-icon" /> }]} onSelect={() => {}} />);
    expect(screen.getByTestId('refine-icon')).toBeInTheDocument();
  });

  it('disables a busy action and swaps in its busyLabel', () => {
    render(<NextStepActions actions={[{ id: 'a', label: 'Refine', busy: true, busyLabel: 'Refining…' }]} onSelect={() => {}} />);
    expect(screen.getByText('Refining…')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  /**
   * i18n wiring proof (per the god-components-extraction-plan.md i18n
   * policy): mounts under a real translated dictionary and asserts the
   * TRANSLATED text renders — not just that the passthrough (unconfigured)
   * case compiles. `@jini-ai/chat-react` has no `I18nProvider` component of its
   * own (unlike `@jini-ai/ui`) — `<JiniChatProvider i18n={...}>` wires an
   * `I18nAdapter` directly into `I18nContext` (see
   * `../hooks/context.ts`/`JiniChatProvider.tsx`) — so this test mounts the
   * context directly, which is the equivalent seam for this package.
   */
  it('renders translated copy when an I18nAdapter with a real dictionary is wired in', () => {
    const dict: Record<string, string> = {
      Continue: 'Weiter',
      'Generate artifact': 'Artefakt erzeugen',
      'Create the missing deliverable': 'Fehlendes Ergebnis erstellen',
    };
    render(
      <I18nContext.Provider value={{ locale: 'de', t: (key) => dict[key] ?? key }}>
        <NextStepActions actions={actions} onSelect={() => {}} />
      </I18nContext.Provider>,
    );
    expect(screen.getByText('Weiter')).toBeInTheDocument();
    expect(screen.getByText('Artefakt erzeugen')).toBeInTheDocument();
    expect(screen.getByText('Fehlendes Ergebnis erstellen')).toBeInTheDocument();
    expect(screen.queryByText('Continue')).not.toBeInTheDocument();
  });
});
