import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AgentRuntimePicker } from '../../components/AgentRuntimePicker.js';
import { ChatPane } from '../../components/ChatPane.js';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import { I18nContext } from '../../../../hooks/context.js';

const note = 'Gemini (Antigravity) always runs with full access to this computer, like running it in your own terminal. Pick Claude or Codex if you want the tool limits.';
const agents = [
  { id: 'antigravity', name: 'Antigravity', available: true, supportsNativeToolAccess: false,
    fullCliAccessOnly: true, fullCliAccessNote: note },
  { id: 'claude', name: 'Claude', available: true, supportsNativeToolAccess: true },
  { id: 'codex', name: 'Codex', available: true, supportsNativeToolAccess: true },
  { id: 'other', name: 'Another CLI', available: true },
];
const policy = { nativeToolAccess: false, cliParity: false,
  permissionMode: 'restricted' as const, nativeCapabilities: { shell: false, userMcp: false } };

it('shows the plain note through ChatPane without owner eligibility before any send', () => {
  const transport = createFakeChatTransport();
  render(<ChatPane transport={transport} agents={agents} selection={{ agentId: 'antigravity' }} nativeToolPolicy={policy} />);
  expect(screen.getByText(note)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(transport.calls).toHaveLength(0);
});

it.each([policy, undefined])('lets a non-owner pick Antigravity with current policy %s and shows the note', async nativeToolPolicy => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<AgentRuntimePicker agents={agents} value={{ agentId: 'claude' }} onChange={onChange}
    {...(nativeToolPolicy ? { nativeToolPolicy } : {})} />);
  await user.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
  const agy = screen.getByRole('radio', { name: /Antigravity/ });
  expect(agy).toHaveTextContent(note);
  expect(agy).toBeEnabled();
  expect(agy).not.toHaveTextContent('Only the owner can change Full CLI access.');
  await user.click(agy);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'antigravity' }));
});

it('uses t() for the note without an owner warning, and clears the note in API mode', () => {
  const t = (key: string) => `translated: ${key}`;
  const props = { agents, value: { agentId: 'antigravity' }, onChange: vi.fn(),
    nativeToolPolicy: policy };
  const { rerender } = render(<I18nContext.Provider value={{ t, locale: 'test' }}><AgentRuntimePicker {...props} /></I18nContext.Provider>);
  expect(screen.getByText(`translated: ${note}`)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  rerender(<I18nContext.Provider value={{ t, locale: 'test' }}><AgentRuntimePicker {...props} executionMode="api" /></I18nContext.Provider>);
  expect(screen.queryByText(`translated: ${note}`)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each(['claude', 'codex'])('keeps %s selectable under the existing tool limits', async agentId => {
  const user = userEvent.setup();
  render(<AgentRuntimePicker agents={agents} value={{ agentId }} onChange={vi.fn()} nativeToolPolicy={policy} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
  expect(screen.getByRole('radio', { name: agentId === 'claude' ? /Claude/ : /Codex/ })).toBeEnabled();
});

it('retains the fail-closed warning for other unsupported adapters', () => {
  render(<AgentRuntimePicker agents={agents} value={{ agentId: 'other' }} onChange={vi.fn()} nativeToolPolicy={policy} />);
  expect(screen.getByRole('alert')).toHaveTextContent("Another CLI can't run");
});
