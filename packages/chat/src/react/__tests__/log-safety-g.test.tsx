// @vitest-environment jsdom
import { useConversation } from '../hooks/useConversation.js';
import { useConversationListView } from '../components/ConversationList.hooks.js';
import { ToolCard } from '../components/ToolCard.js';
import { createToolRendererRegistry } from '../tool-renderer-registry.js';
import { useChatPaneFileDrop } from '../features/chat-pane/hooks/useChatPaneFileDrop.hooks.js';
import React from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createConsoleLogger } from '@jini-ai/core/primitives';
import { runComposerHostEffect } from '../components/Composer.hooks.js';
import { ExtEventErrorBoundary } from '../components/ExtEventErrorBoundary.js';
import { useConversationTitleEditor } from '../components/ConversationTitleEditor.hooks.js';
import { useRunStream } from '../hooks/useRunStream.js';
import type { ChatTransport } from '../../core/transport.js';

const sentinel = 'violet tern private harbour';
const failure = () => Object.assign(new Error(sentinel), { stack: sentinel });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['sync', 'async'] as const)('delivers a %s host effect failure once without leaking', async mode => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  const report = { error: vi.fn(createConsoleLogger({ prefix: '' }).error) };
  const settled = vi.fn();
  const resolved = vi.fn();
  runComposerHostEffect({ effectName: 'attachmentPicker.onFiles', effect: () => { if (mode === 'sync') throw failure(); return Promise.reject(sentinel); } }, { report, onSettled: settled, onResolved: resolved });
  await waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
  expect(resolved).not.toHaveBeenCalled();
  expect(report.error).toHaveBeenCalledTimes(1);
  expect(output).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(output.mock.calls)).not.toContain(sentinel);
});

it('renders a fixed extension fallback and delivers the original to the host report', async () => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  const report = { error: vi.fn(createConsoleLogger({ prefix: '[owned-test]' }).error) };
  const error = failure();
  const Broken = (): React.ReactNode => { throw error; };
  render(<ExtEventErrorBoundary name="example" report={report}><Broken /></ExtEventErrorBoundary>);
  expect(screen.getByRole('alert').textContent).toBe('"example" could not be rendered (Error).');
  expect(screen.getByRole('alert').textContent).not.toContain(sentinel);
  expect(report.error).toHaveBeenCalledTimes(1);
  expect(report.error.mock.calls[0]?.[1]?.error).toBe(error);
  expect(JSON.stringify(output.mock.calls.filter(([line]) => typeof line === 'string' && line.startsWith('[owned-test]')))).not.toContain(sentinel);
});

it('rename rejection is reported once and the draft is committed once', async () => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  const report = { error: vi.fn(createConsoleLogger({ prefix: '' }).error) };
  const onCommit = vi.fn(async () => { throw failure(); });
  const { result } = renderHook(() => useConversationTitleEditor({ title: 'before', onCommit, onCancel: vi.fn() }, { report }));
  act(() => result.current.setDraft('after'));
  await act(async () => { await result.current.finish(); await result.current.finish(); });
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(report.error).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(output.mock.calls)).not.toContain(sentinel);
});

it.each(['sync', 'async'] as const)('cancel observes a %s stop failure without changing cancellation', async mode => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  const report = { error: vi.fn(createConsoleLogger({ prefix: '' }).error) };
  const transport = { startRun: async () => ({ runId: 'run' }), stopRun: () => { if (mode === 'sync') throw failure(); return Promise.reject(sentinel); } } as unknown as ChatTransport;
  const { result } = renderHook(() => useRunStream({ transport }, { report }));
  await act(async () => { await result.current.start({ history: [] }); });
  act(() => result.current.cancel());
  await waitFor(() => expect(report.error).toHaveBeenCalledTimes(1));
  expect(result.current.status).toBe('canceled');
  expect(JSON.stringify(output.mock.calls)).not.toContain(sentinel);
});

it('a registered renderer failure reports once and keeps the built-in card', () => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  const report = { error: vi.fn(createConsoleLogger({ prefix: '' }).error) };
  const registry = createToolRendererRegistry({});
  registry.register({ name: 'Bash', renderer: () => { throw failure(); } });
  const { container } = render(<ToolCard report={report} useToolRendererRegistryHook={() => registry} use={{ kind: 'tool_use', id: 'tool', name: 'Bash', input: { command: 'echo ready' } }} runSucceeded />);
  expect(container.textContent).toContain('echo ready');
  expect(report.error).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(output.mock.calls)).not.toContain(sentinel);
});

it.each(['sync', 'async'] as const)('file drop reports a %s callback failure and retains its target', async mode => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  const report = { error: vi.fn(createConsoleLogger({ prefix: '' }).error) };
  let deliver!: (files: File[]) => void;
  const { result } = renderHook(() => useChatPaneFileDrop({ enabled: true, report, onFiles: () => { if (mode === 'sync') throw failure(); return Promise.reject(sentinel); }, useFileDropTargetHook: callback => {
    deliver = callback;
    return { draggingFiles: false, dropReadError: null, clearDropReadError: vi.fn(), onDragEnter: vi.fn(), onDragOver: vi.fn(), onDragLeave: vi.fn(), onDrop: vi.fn() };
  } }));
  act(() => deliver([new File(['image'], 'image.png')]));
  await waitFor(() => expect(report.error).toHaveBeenCalledTimes(1));
  expect(result.current.dropReadError).toBeNull();
  expect(result.current.draggingFiles).toBe(false);
  expect(JSON.stringify(output.mock.calls)).not.toContain(sentinel);
});

it.each(['sync', 'async'] as const)('conversation create reports a %s rejection without a phantom row', async mode => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  const report = { error: vi.fn(createConsoleLogger({ prefix: '' }).error) };
  const onCreate = vi.fn(() => { if (mode === 'sync') throw failure(); return Promise.reject(sentinel); });
  const { result } = renderHook(() => useConversationListView({ savedConversations: [], activeConversationId: null, onSelect: vi.fn(), onCreate, onDelete: undefined, onRename: undefined, onSearch: undefined, confirmDelete: undefined, emptyState: undefined, t: key => key }, { report }));
  act(() => result.current.createConversation());
  await waitFor(() => expect(report.error).toHaveBeenCalledTimes(1));
  expect(result.current.open).toBe(false);
  expect(result.current.conversations).toEqual([]);
  expect(onCreate).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(output.mock.calls)).not.toContain(sentinel);
});

it.each([failure(), sentinel])('refresh reports a failed read and preserves messages for a later retry', async error => {
  vi.useFakeTimers();
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  const report = { error: vi.fn(createConsoleLogger({ prefix: '' }).error) };
  const visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const focus = new EventTarget();
  const saved = { id: 'saved', role: 'assistant' as const, content: 'retained' };
  const loadMessages = vi.fn().mockRejectedValueOnce(error).mockResolvedValue([saved]);
  const { result, unmount } = renderHook(() => useConversation({ transport: {} as ChatTransport, initialMessages: [saved], report, refreshSignal: { visibility, focus, loadMessages } }));
  try {
    focus.dispatchEvent(new Event('focus'));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(result.current.messages).toEqual([saved]);
    expect(report.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(output.mock.calls)).not.toContain(sentinel);
    focus.dispatchEvent(new Event('focus'));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(loadMessages).toHaveBeenCalledTimes(2);
    expect(result.current.messages).toEqual([saved]);
  } finally { unmount(); vi.useRealTimers(); }
});
