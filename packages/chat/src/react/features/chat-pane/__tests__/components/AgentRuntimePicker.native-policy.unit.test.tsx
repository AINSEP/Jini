import { act, screen } from '@testing-library/react';
import { renderWithChatSurfaces } from '../../../../__tests__/fake-chat-surfaces.js';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AgentRuntimePicker } from '../../components/AgentRuntimePicker.js';
import { ChatPane } from '../../components/ChatPane.js';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import { I18nContext } from '../../../../hooks/context.js';
import { assessNativeToolPolicy } from '@jini-ai/agent-runtime/native-tool-policy';

const note = 'Gemini (Antigravity) always runs with full access to this computer, like running it in your own terminal. Pick Claude or Codex if you want the tool limits.';
const agents = [
  { id: 'antigravity', name: 'Antigravity', available: true, supportsNativeToolAccess: false,
    fullCliAccessOnly: true, fullCliAccessNote: note },
  { id: 'claude', name: 'Claude', available: true, supportsNativeToolAccess: true },
  { id: 'codex', name: 'Codex', available: true, supportsNativeToolAccess: true },
  { id: 'other', name: 'Another CLI', available: true },
];
const limits = { nativeToolAccess: false, cliParity: false,
  permissionMode: 'restricted' as const, nativeCapabilities: { shell: false, userMcp: false } };
// The host binds its runtime's assessor with the limits; this suite binds the real one.
const policy = { limits, assess: assessNativeToolPolicy };

it('shows the plain note through ChatPane without owner eligibility before any send', () => {
  const transport = createFakeChatTransport();
  renderWithChatSurfaces(<ChatPane transport={transport} agents={agents} selection={{ agentId: 'antigravity' }} nativeToolPolicy={policy} />);
  expect(screen.getByText(note)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(transport.calls).toHaveLength(0);
});

it.each([policy, undefined])('lets a non-owner pick Antigravity with current policy %s and shows the note', async nativeToolPolicy => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithChatSurfaces(<AgentRuntimePicker agents={agents} value={{ agentId: 'claude' }} onChange={onChange}
    {...(nativeToolPolicy ? { nativeToolPolicy } : {})} />);
  await user.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
  const agy = screen.getByRole('radio', { name: /Antigravity/ });
  // The note is the radio's description, read from the warning icon beside it (owner 2026-10-30).
  expect(agy).toHaveAccessibleDescription(note);
  expect(agy).toBeEnabled();
  expect(agy).not.toHaveTextContent('Only the owner can change Full CLI access.');
  await user.click(agy);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'antigravity' }));
});

it('uses t() for the note without an owner warning, and clears the note in API mode', () => {
  const t = (key: string) => `translated: ${key}`;
  const props = { agents, value: { agentId: 'antigravity' }, onChange: vi.fn(),
    nativeToolPolicy: policy };
  const { rerender } = renderWithChatSurfaces(<I18nContext.Provider value={{ t, locale: 'test' }}><AgentRuntimePicker {...props} /></I18nContext.Provider>);
  expect(screen.getByText(`translated: ${note}`)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  rerender(<I18nContext.Provider value={{ t, locale: 'test' }}><AgentRuntimePicker {...props} executionMode="api" /></I18nContext.Provider>);
  expect(screen.queryByText(`translated: ${note}`)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each(['claude', 'codex'])('keeps %s selectable under the existing tool limits', async agentId => {
  const user = userEvent.setup();
  renderWithChatSurfaces(<AgentRuntimePicker agents={agents} value={{ agentId }} onChange={vi.fn()} nativeToolPolicy={policy} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
  expect(screen.getByRole('radio', { name: agentId === 'claude' ? /Claude/ : /Codex/ })).toBeEnabled();
});

it('discloses unsupported adapter limits through an accessible tip without a toolbar paragraph', async () => {
  const user = userEvent.setup();
  renderWithChatSurfaces(<AgentRuntimePicker agents={agents} value={{ agentId: 'other' }} onChange={vi.fn()} nativeToolPolicy={policy} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  const icon = screen.getByRole('button', { name: 'Agent permissions required' });
  expect(icon).toHaveAccessibleDescription(/Another CLI can't run/);
  expect(icon).toHaveAccessibleDescription(/gear → More settings → Agent permissions/);
  expect(screen.getByText(/Another CLI can't run/).closest('p')).toBeNull();
  await user.pointer({ keys: '[TouchA]', target: icon });
  expect(icon).toHaveAttribute('aria-expanded', 'true');
  await user.pointer({ keys: '[TouchA]', target: icon });
  act(() => icon.blur());
  act(() => icon.focus());
  expect(icon).toHaveAttribute('aria-expanded', 'true');
});

it('reads the limits only through the assessor the host injected with them', () => {
  const assess = vi.fn(({ def }: { def: { name: string } }) => `host rule refuses ${def.name}`);
  renderWithChatSurfaces(<AgentRuntimePicker agents={agents} value={{ agentId: 'other' }} onChange={vi.fn()}
    nativeToolPolicy={{ limits, assess }} />);
  expect(assess).toHaveBeenCalledWith({ def: expect.objectContaining({ id: 'other', name: 'Another CLI' }), policy: limits });
  expect(screen.getByRole('button', { name: 'Agent permissions required' })).toHaveAccessibleDescription('host rule refuses Another CLI');
});

it('shows no permissions tip when the injected assessor allows the run', () => {
  renderWithChatSurfaces(<AgentRuntimePicker agents={agents} value={{ agentId: 'other' }} onChange={vi.fn()}
    nativeToolPolicy={{ limits, assess: () => null }} />);
  expect(screen.queryByRole('button', { name: 'Agent permissions required' })).not.toBeInTheDocument();
});
