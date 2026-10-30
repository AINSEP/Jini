import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AgentRuntimePicker } from '../../components/AgentRuntimePicker.js';
import { ChatPane } from '../../components/ChatPane.js';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';

const agents = [
  { id: 'antigravity', name: 'Antigravity', available: true, supportsNativeToolAccess: false },
  { id: 'claude', name: 'Claude', available: true, supportsNativeToolAccess: true },
  { id: 'other', name: 'Another CLI', available: true },
];
const policy = { nativeToolAccess: true, cliParity: true, permissionMode: 'bypass' as const,
  nativeCapabilities: { shell: true, userMcp: false } };

it('carries the host limits through ChatPane to the real picker before any send', () => {
  const transport = createFakeChatTransport();
  render(<ChatPane transport={transport} agents={agents} selection={{ agentId: 'antigravity' }} nativeToolPolicy={policy} />);
  expect(screen.getByRole('alert')).toHaveTextContent("Antigravity can't run with 'Your MCP servers' off");
  expect(transport.calls).toHaveLength(0);
});

it('warns before sending, follows the current limits and selection, and clears in API mode', () => {
  const props = { agents, value: { agentId: 'antigravity' }, onChange: vi.fn(), nativeToolPolicy: policy };
  const { rerender } = render(<AgentRuntimePicker {...props} />);
  expect(screen.getByRole('alert')).toHaveTextContent("Antigravity can't run with 'Your MCP servers' off");
  rerender(<AgentRuntimePicker {...props} nativeToolPolicy={{ ...policy, nativeCapabilities: { userMcp: true } }} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  rerender(<AgentRuntimePicker {...props} nativeToolPolicy={{ ...policy, nativeCapabilities: { shell: false } }} />);
  expect(screen.getByRole('alert')).toHaveTextContent("'Bash/shell' off");
  rerender(<AgentRuntimePicker {...props} value={{ agentId: 'claude' }} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  rerender(<AgentRuntimePicker {...props} value={{ agentId: 'other' }} />);
  expect(screen.getByRole('alert')).toHaveTextContent("Another CLI can't run");
  rerender(<AgentRuntimePicker {...props} executionMode="api" />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
