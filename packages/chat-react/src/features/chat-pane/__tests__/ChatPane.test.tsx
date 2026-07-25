import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@jini/chat-core';
import { createFakeChatTransport } from '../../../react/hooks/testing/fake-transport.js';
import { ChatPane } from '../react/components/ChatPane.js';
import type { ChatPaneActivity, ChatPaneAgent } from '../types.js';

const agents: ChatPaneAgent[] = [{
  id: 'codex',
  name: 'Codex CLI',
  available: true,
  models: [{ id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra' }],
  reasoningOptions: [{ id: 'medium', label: 'Medium' }],
}];

const welcome: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Welcome to Jini.',
  runStatus: 'succeeded',
  createdAt: 1,
};

describe('ChatPane', () => {
  it('owns composer/conversation/send orchestration and forwards selection plus run context', async () => {
    const transport = createFakeChatTransport();
    const activities: ChatPaneActivity[] = [];
    render(
      <ChatPane
        title="Starter Site"
        transport={transport}
        agents={agents}
        initialMessages={[welcome]}
        initialSelection={{ agentId: '' }}
        placeholder="Ask Jini…"
        suggestions={['Inspect this project']}
        initialWorkingDirectory="examples/sample-projects/starter-site"
        runContext={({ selection, prompt, workingDirectory }) => ({
          project: 'starter-site',
          model: selection.model,
          reasoning: selection.reasoning,
          promptLength: prompt.length,
          workingDirectory,
        })}
        onActivityChange={(activity) => activities.push(activity)}
      />,
    );

    expect(screen.getByText('Welcome to Jini.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Inspect this project' }));
    expect(screen.getByPlaceholderText('Ask Jini…')).toHaveValue('Inspect this project');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(transport.calls[0]?.input).toMatchObject({
      agentId: 'codex',
      context: {
        project: 'starter-site',
        model: 'gpt-5.6-terra',
        reasoning: 'medium',
        promptLength: 20,
        workingDirectory: 'examples/sample-projects/starter-site',
      },
    });
    expect(screen.getAllByText('Inspect this project')).toHaveLength(2);
    expect(activities).toContain('queued');
    expect(activities).toContain('streaming');

    act(() => {
      transport.emit({ kind: 'text', text: 'Done.' });
      transport.finish([{ kind: 'text', text: 'Done.' }]);
    });
    expect(await screen.findByText('Done.')).toBeInTheDocument();
    await waitFor(() => expect(activities).toContain('ready'));
  });

  it('supports controlled selection, static context, cancellation, reset, and host slots', async () => {
    const transport = createFakeChatTransport();
    const onSelectionChange = vi.fn();
    render(
      <ChatPane
        title="Controlled"
        transport={transport}
        agents={agents}
        selection={{ agentId: 'codex', model: 'gpt-5.6-terra', reasoning: 'medium' }}
        onSelectionChange={onSelectionChange}
        initialMessages={[welcome]}
        runContext={{ project: 'controlled' }}
        leadingAccessory={<span>Custom leading</span>}
        footer={<div>Custom footer</div>}
      />,
    );
    expect(screen.getByText('Custom leading')).toBeInTheDocument();
    expect(screen.getByText('Custom footer')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Send a message…'), 'Run');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(transport.calls[0]?.input.context).toEqual({ project: 'controlled' });

    await userEvent.click(screen.getByRole('button', { name: 'Stop run' }));
    await userEvent.click(screen.getByRole('button', { name: 'New thread' }));
    expect(screen.queryByText('Run')).not.toBeInTheDocument();
    expect(screen.getByText('Welcome to Jini.')).toBeInTheDocument();
  });

  it('fails closed with no available agent and surfaces transport errors', async () => {
    const unavailable = [{ id: 'missing', name: 'Missing', available: false }] satisfies ChatPaneAgent[];
    const transport = createFakeChatTransport();
    const { rerender } = render(
      <ChatPane
        title="Unavailable"
        transport={transport}
        agents={unavailable}
        header={<div>Custom header</div>}
      />,
    );
    expect(screen.getByText('Custom header')).toBeInTheDocument();
    expect(screen.getByText('No usable CLI is selected.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    rerender(<ChatPane title="Failure" transport={transport} agents={agents} />);
    await userEvent.type(screen.getByPlaceholderText('Send a message…'), 'Fail');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    act(() => transport.fail(new Error('runtime failed')));
    expect(await screen.findByText('runtime failed')).toBeInTheDocument();
  });

  it('supports package defaults and host styling/composer extension props', () => {
    const transport = createFakeChatTransport();
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        conversationId="conversation-1"
        initialDraft="Initial draft"
        workingDirectory={null}
        projectFileNames={new Set(['index.ts'])}
        composerSlots={{ mentionSources: [] }}
        onRescanAgents={() => {}}
        className="host-position"
        style={{ minHeight: 400 }}
        disabled
      />,
    );
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Send a message…')).toHaveValue('Initial draft');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Chat' }).closest('section'))
      .toHaveClass('jini-chat-pane--workspace', 'host-position');
    expect(screen.getByRole('heading', { name: 'Chat' }).closest('section'))
      .toHaveStyle({ minHeight: '400px' });
  });

  it('owns file picking/upload staging and forwards uploaded attachments on send', async () => {
    const transport = createFakeChatTransport();
    const uploaded = {
      path: '/tmp/reference.png',
      name: 'reference.png',
      kind: 'image' as const,
    };
    const uploadAttachments = vi.fn(async () => [uploaded]);
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        uploadAttachments={uploadAttachments}
        attachmentAccept="image/*"
      />,
    );

    const file = new File(['image bytes'], 'reference.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Attach files', { selector: 'input' }), file);
    await waitFor(() => expect(uploadAttachments).toHaveBeenCalledWith(
      [file],
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        batchId: expect.any(String),
      }),
    ));
    expect(screen.getByText('reference.png')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Send a message…'), 'Use this reference');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(transport.calls[0]?.input.attachments).toEqual([uploaded]);
  });

  it('accepts file drops across the composer area and ignores non-file drags', async () => {
    const transport = createFakeChatTransport();
    const uploadAttachments = vi.fn(async (files: File[]) => files.map((file) => ({
      path: `/tmp/${file.name}`,
      name: file.name,
      kind: 'file' as const,
    })));
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        uploadAttachments={uploadAttachments}
        initialWorkingDirectory="/work/project"
      />,
    );
    const target = screen.getByTestId('chat-pane-file-drop-target');
    const textTransfer = {
      types: ['text/plain'],
      items: [],
      files: [],
      dropEffect: 'none',
    };
    fireEvent.dragEnter(target, { dataTransfer: textTransfer });
    expect(target).not.toHaveClass('is-dragging-files');

    const file = new File(['drop content'], 'dropped.txt', { type: 'text/plain' });
    const fileTransfer = {
      types: ['Files'],
      items: [],
      files: [file],
      dropEffect: 'none',
    };
    fireEvent.dragEnter(target, { dataTransfer: fileTransfer });
    expect(target).toHaveClass('is-dragging-files');
    expect(screen.getByRole('status')).toHaveTextContent('Drop files to attach');
    fireEvent.dragOver(target, { dataTransfer: fileTransfer });
    expect(fileTransfer.dropEffect).toBe('copy');
    fireEvent.drop(target, { dataTransfer: fileTransfer });

    await waitFor(() => expect(uploadAttachments).toHaveBeenCalledWith(
      [file],
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        batchId: expect.any(String),
      }),
    ));
    expect(target).not.toHaveClass('is-dragging-files');
    expect(await screen.findByText('dropped.txt')).toBeInTheDocument();
  });

  it('owns the package working-directory picker and delegates only native I/O plus changes', async () => {
    const transport = createFakeChatTransport();
    const onChangeWorkingDirectory = vi.fn();
    const workingDirectoryAccess = {
      pickWorkingDirectory: vi.fn(async () => '/Users/test/selected'),
      recentDirectories: vi.fn(async () => ['/Users/test/previous']),
      directoryExists: vi.fn(async () => true),
    };
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        initialWorkingDirectory="/Users/test/current"
        onChangeWorkingDirectory={onChangeWorkingDirectory}
        workingDirectoryAccess={workingDirectoryAccess}
      />,
    );

    await userEvent.click(screen.getByTestId('working-dir-trigger'));
    await userEvent.click(screen.getByTestId('working-dir-pick'));
    await waitFor(() => expect(onChangeWorkingDirectory).toHaveBeenCalledWith('/Users/test/selected'));
    expect(screen.getByTestId('working-dir-trigger')).toHaveTextContent('selected');

    await userEvent.click(screen.getByTestId('working-dir-trigger'));
    await waitFor(() => expect(workingDirectoryAccess.recentDirectories).toHaveBeenCalled());
    await userEvent.hover(screen.getByTestId('working-dir-recent'));
    await userEvent.click(screen.getByTitle('/Users/test/previous'));
    await waitFor(() => expect(onChangeWorkingDirectory).toHaveBeenCalledWith('/Users/test/previous'));
    expect(workingDirectoryAccess.directoryExists).toHaveBeenCalledWith('/Users/test/previous');
  });

  it('renders package-owned attachment and working-directory capability errors', async () => {
    const transport = createFakeChatTransport();
    render(
      <ChatPane
        transport={transport}
        agents={agents}
        uploadAttachments={async () => {
          throw new Error('attachment upload unavailable');
        }}
        initialWorkingDirectory="/Users/test/current"
        workingDirectoryAccess={{
          pickWorkingDirectory: async () => null,
          recentDirectories: async () => {
            throw new Error('recent folders unavailable');
          },
          directoryExists: async () => true,
        }}
      />,
    );

    await userEvent.upload(
      screen.getByLabelText('Attach files', { selector: 'input' }),
      new File(['content'], 'notes.txt', { type: 'text/plain' }),
    );
    expect(await screen.findByText('attachment upload unavailable')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('working-dir-trigger'));
    expect(await screen.findByText('recent folders unavailable')).toBeInTheDocument();
  });

  it('renders pending, invalid, and runtime inventory failure states', async () => {
    let resolveExists!: (exists: boolean) => void;
    const exists = new Promise<boolean>((resolve) => {
      resolveExists = resolve;
    });
    const transport = createFakeChatTransport();
    render(
      <ChatPane
        transport={transport}
        runtimeAccess={{
          listAgents: async () => {
            throw new Error('inventory unavailable');
          },
          rescanAgents: async () => [],
          daemonOnline: async () => false,
        }}
        initialWorkingDirectory="/work/pending"
        workingDirectoryAccess={{
          pickWorkingDirectory: async () => null,
          recentDirectories: async () => [],
          directoryExists: async () => exists,
        }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Checking working directory…');
    expect(await screen.findByText('inventory unavailable')).toBeInTheDocument();
    await act(async () => resolveExists(false));
    expect(await screen.findByText('Working directory is unavailable.')).toBeInTheDocument();
  });
});
