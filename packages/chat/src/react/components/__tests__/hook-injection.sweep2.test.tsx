// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { useT } from '../../hooks/context.js';
import { FolderChips } from '../FolderChips.js';
import { ConversationTitleEditor, defaultConversationTitleEditorHooks } from '../ConversationTitleEditor.js';
import { SentAttachmentButton } from '../SentAttachment.js';
import { ToolCallGroup, defaultToolCallGroupHooks } from '../ToolCallGroup.js';
import { ConversationList, defaultConversationListHooks } from '../ConversationList.js';
import { AttachmentPreviewModal, defaultAttachmentPreviewModalHooks } from '../AttachmentPreviewModal.js';
import { ThinkingBlock } from '../MessageRow.js';
import { AgentPluginUsage } from '../../features/chat-pane/components/AgentPluginUsage.js';

/** A translator that is visibly not the key, so a test proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key, vars) => `«${key}${vars ? JSON.stringify(vars) : ''}»`;

describe('FolderChips', () => {
  it('renders the injected translator and the list builder of the injected hook', () => {
    const list = vi.fn(() => <ul data-testid="fake-list" />);
    const setExpanded = vi.fn();
    const useFolderChips = vi.fn(() => ({ expanded: true, setExpanded, id: 'fake-id', list }));
    render(<FolderChips folders={['/a/one', '/a/two']} hooks={{ useT: useQuotingT, useFolderChips: useFolderChips as never }} />);
    expect(screen.getByRole('button', { name: '«Folders ({count}){"count":2}»' })).toBeInTheDocument();
    expect(screen.getByTestId('fake-list')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Folders/ }));
    expect(setExpanded).toHaveBeenCalledTimes(1);
  });
});

describe('ConversationTitleEditor', () => {
  it('renders the draft and key handling of the injected hook', () => {
    const setDraft = vi.fn();
    const handleKeyDown = vi.fn();
    const useEditor = vi.fn(() => ({ draft: 'fake draft', setDraft, finish: vi.fn(), handleKeyDown }));
    render(<ConversationTitleEditor title="T" onCommit={vi.fn()} onCancel={vi.fn()} hooks={{ ...defaultConversationTitleEditorHooks, useT: useQuotingT, useConversationTitleEditor: useEditor as never }} />);
    const input = screen.getByRole('textbox', { name: '«Rename chat»' });
    expect(input).toHaveValue('fake draft');
    fireEvent.change(input, { target: { value: 'next' } });
    expect(setDraft).toHaveBeenCalledWith('next');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handleKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe('SentAttachmentButton', () => {
  it('renders the thumbnail of the injected hook and its translated label', () => {
    const useThumb = vi.fn(() => ({ thumbnailUrl: 'blob:fake-thumb', onThumbnailError: vi.fn() }));
    const onOpen = vi.fn();
    const attachment = { name: 'pic.png', path: 'pic.png' } as never;
    const { container } = render(<SentAttachmentButton attachment={attachment} onOpen={onOpen} hooks={{ useT: useQuotingT, useSentAttachmentThumbnail: useThumb as never }} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:fake-thumb');
    fireEvent.click(screen.getByRole('button', { name: /^«Open \{name\}/ }));
    expect(onOpen).toHaveBeenCalledWith(attachment);
  });
});

describe('ToolCallGroup', () => {
  it('renders the group state of the injected hook and its toggle', () => {
    const toggle = vi.fn();
    const useGroup = vi.fn(() => ({ open: false, toggle, failed: false, running: false, label: 'Fake group label', failureLabel: undefined }));
    render(<ToolCallGroup rows={[]} renderRow={() => null} hooks={{ ...defaultToolCallGroupHooks, useToolCallGroup: useGroup as never, useT: useQuotingT }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fake group label' }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('uses the injected translator for the failure-only layout', () => {
    const useGroup = vi.fn(() => ({ open: false, toggle: vi.fn(), failed: true, running: false, label: 'x', failureLabel: undefined }));
    render(<ToolCallGroup rows={[]} renderRow={() => null} failureOnly hooks={{ useToolCallGroup: useGroup as never, useT: useQuotingT }} />);
    expect(screen.getByText('«A step failed»')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '«Show»' })).toBeInTheDocument();
  });
});

describe('translator-only components', () => {
  it('ThinkingBlock renders the injected translator', () => {
    render(<ThinkingBlock text="reasoning" useTHook={useQuotingT} />);
    expect(screen.getByText('«Thinking»')).toBeInTheDocument();
  });

  it('AgentPluginUsage renders nothing without a strip, calling the injected hook first', () => {
    const useFakeT = vi.fn(useQuotingT);
    const { container } = render(<AgentPluginUsage messages={[]} useTHook={useFakeT} />);
    expect(useFakeT).toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('hooks wrapped by a spy that still drives the real view-model', () => {
  it('ConversationList passes its inputs to the injected view hook and renders the injected translator', () => {
    const useView = vi.fn(defaultConversationListHooks.useConversationListView);
    render(
      <ConversationList
        conversations={[{ id: 'c1', title: 'First', updatedAt: 1 }]}
        activeConversationId="c1"
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        hooks={{ useT: useQuotingT, useConversationListView: useView }}
      />,
    );
    expect(useView).toHaveBeenCalledWith(expect.objectContaining({ activeConversationId: 'c1' }));
    fireEvent.click(screen.getByTestId('conversation-trigger'));
    expect(screen.getByText('«Conversations»')).toBeInTheDocument();
  });

  it('AttachmentPreviewModal labels its dialog with the injected translator and drives the injected modal hook', () => {
    const useModal = vi.fn(defaultAttachmentPreviewModalHooks.useAttachmentPreviewModal);
    const attachment = { name: 'notes.txt', path: 'notes.txt' } as never;
    render(<AttachmentPreviewModal attachment={attachment} onClose={vi.fn()} hooks={{ useT: useQuotingT, useAttachmentPreviewModal: useModal }} />);
    expect(useModal).toHaveBeenCalledWith(expect.objectContaining({ attachment }));
    expect(document.querySelector('dialog')?.getAttribute('aria-label')).toBe('«{name} preview{"name":"notes.txt"}»');
  });
});
