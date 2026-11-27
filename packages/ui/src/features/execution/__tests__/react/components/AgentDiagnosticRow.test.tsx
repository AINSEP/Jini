import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentDiagnostic } from '@jini-ai/core/contracts/execution';
import { AgentDiagnosticRow } from '../../../react/components/AgentDiagnosticRow.js';

const useKeyT = () => (key: string) => `t:${key}`;

const base: AgentDiagnostic = { reason: 'not-on-path', severity: 'warning', message: 'codex was not found on PATH' };

describe('AgentDiagnosticRow', () => {
  it('offers one button per wired intent, in order, each calling its own handler', () => {
    const handlers = { onOpenInstall: vi.fn(), onOpenDocs: vi.fn(), onRescan: vi.fn() };
    const diagnostic: AgentDiagnostic = { ...base, fixActions: [{ kind: 'rescan' }, { kind: 'openDocs' }, { kind: 'openInstall' }] };
    render(<AgentDiagnosticRow diagnostic={diagnostic} handlers={handlers} useTHook={useKeyT} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['t:Rescan', 't:Docs', 't:Install']);
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual(['t:Rescan', 't:Docs', 't:Install']);

    fireEvent.click(buttons[1]!);
    expect(handlers.onOpenDocs).toHaveBeenCalledTimes(1);
    expect(handlers.onRescan).not.toHaveBeenCalled();
    fireEvent.click(buttons[0]!);
    expect(handlers.onRescan).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[2]!);
    expect(handlers.onOpenInstall).toHaveBeenCalledTimes(1);
  });

  it('offers no button for the unwired intents, nor for a wired intent whose handler is missing', () => {
    const diagnostic: AgentDiagnostic = {
      ...base,
      fixActions: [{ kind: 'setEnv', envKey: 'CODEX_BIN' }, { kind: 'clearEnv', envKey: 'CODEX_BIN' }, { kind: 'launchOAuth', agentId: 'codex' }, { kind: 'openDocs' }, { kind: 'rescan' }, { kind: 'openInstall' }],
    };
    const { container } = render(<AgentDiagnosticRow diagnostic={diagnostic} handlers={{ onRescan: vi.fn() }} useTHook={useKeyT} />);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['t:Rescan']);
    expect(container.querySelector('.jini-agent-diagnostic-actions')).not.toBeNull();
  });

  it('renders no action strip when nothing resolves, and with no handlers at all', () => {
    const { container } = render(
      <AgentDiagnosticRow diagnostic={{ ...base, fixActions: [{ kind: 'setEnv', envKey: 'CODEX_BIN' }, { kind: 'openDocs' }] }} useTHook={useKeyT} />,
    );
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(container.querySelector('.jini-agent-diagnostic-actions')).toBeNull();
  });

  it('marks the group with severity, reason and class, and puts detail plus searched dirs in the tooltip', () => {
    const diagnostic: AgentDiagnostic = { ...base, severity: 'error', detail: 'exit 127', searchedDirs: ['/usr/bin', '/opt/bin'] };
    render(<AgentDiagnosticRow diagnostic={diagnostic} className="extra" useTHook={useKeyT} />);
    const group = screen.getByRole('group');
    expect(group).toHaveClass('jini-agent-diagnostic', 'is-error', 'extra');
    expect(group).toHaveAttribute('data-reason', 'not-on-path');
    expect(screen.getByText('codex was not found on PATH')).toHaveAttribute('title', 'exit 127\n/usr/bin\n/opt/bin');
  });

  it('leaves the message without a title when there is no detail to show', () => {
    render(<AgentDiagnosticRow diagnostic={base} useTHook={useKeyT} />);
    expect(screen.getByText('codex was not found on PATH')).not.toHaveAttribute('title');
    expect(screen.getByRole('group').className).toBe('jini-agent-diagnostic is-warning');
  });

  it('a fix intent from a newer host (unknown kind on the wire) offers no button instead of crashing the row', () => {
    const wire: AgentDiagnostic = JSON.parse('{"reason":"not-on-path","severity":"error","message":"m","fixActions":[{"kind":"futureFix"},{"kind":"rescan"}]}');
    render(<AgentDiagnosticRow diagnostic={wire} handlers={{ onRescan: vi.fn() }} useTHook={useKeyT} />);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['t:Rescan']);
  });
});
