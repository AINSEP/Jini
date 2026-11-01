import { createRef } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatPane } from '../features/chat-pane/components/ChatPane.js';
import type { ChatPaneComposerHandle } from '../features/chat-pane/types.js';
import { useComposer } from '../hooks/useComposer.js';
import { __resetComposerDraftCacheForTests } from '../hooks/composer-draft-cache.js';
import { createFakeChatTransport } from '../hooks/testing/fake-transport.js';
import { acceptedInputsFromMessages } from '../../core/accepted-input.js';
import type { ChatMessage } from '../../core/messages.js';

const folders = ['/tmp/Folder with spaces', String.raw`C:\A B`, String.raw`\\srv\share`];
const agents = [{ id: 'agent', name: 'Agent', available: true }];
beforeEach(() => __resetComposerDraftCacheForTests());

it('keeps folders separate from text through draft reload, acceptance, storage and replay', async () => {
  const draft = renderHook(() => useComposer({ conversationId: 'folders', initialDraft: 'Inspect these' }));
  act(() => { draft.result.current.setDraft('Inspect these'); draft.result.current.addFolders({ folders }); });
  expect(draft.result.current.draft).toBe('Inspect these');
  draft.unmount();
  __resetComposerDraftCacheForTests({ keepStorage: true });
  const transport = createFakeChatTransport();
  let messages: ChatMessage[] = [];
  render(<ChatPane transport={transport} agents={agents} conversationId="folders" onMessagesChange={next => { messages = next; }} />);
  expect(screen.getByRole('textbox')).toHaveValue('Inspect these');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(transport.calls).toHaveLength(1));
  expect(transport.calls[0]?.input.folders).toEqual(folders);
  const accepted = messages.find(message => message.role === 'user');
  expect(accepted?.folders).toEqual(folders);
  await waitFor(() => expect(acceptedInputsFromMessages({ messages })[0]?.folders).toEqual(folders));
  act(() => transport.finish([]));
});

it('expands all folder names, copies exact paths, collapses and removes only the selected folder', async () => {
  const handle = createRef<ChatPaneComposerHandle>();
  const transport = createFakeChatTransport();
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<ChatPane transport={transport} agents={agents} composerHandle={handle} initialDraft="inspect" />);
  act(() => handle.current!.addFolders({ folders }));
  const disclosure = screen.getByRole('button', { name: 'Folders (3)' });
  expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  expect(disclosure.closest('.jini-composer-attachments')).not.toBeNull();
  fireEvent.click(disclosure);
  expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  for (const [index, name] of ['Folder with spaces', 'A B', 'share'].entries()) {
    const item = screen.getByText(name);
    expect(item).toHaveAttribute('title', folders[index]);
    expect(item).toHaveAttribute('aria-label', folders[index]);
  }
  fireEvent.click(screen.getByRole('button', { name: `Copy folder path: ${folders[1]}` }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(folders[1]));
  fireEvent.click(screen.getByRole('button', { name: `Remove folder: ${folders[0]}` }));
  expect(screen.queryByText('Folder with spaces')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Folders (2)' }));
  expect(screen.queryByText('share')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(transport.calls).toHaveLength(1));
  const user = document.querySelector('.jini-message-user')! as HTMLElement;
  const sentDisclosure = within(user).getByRole('button', { name: 'Folders (2)' });
  expect(sentDisclosure.closest('.jini-message-attachments')).not.toBeNull();
  fireEvent.click(sentDisclosure);
  expect(within(user).getByText('share')).toBeInTheDocument();
  expect(within(user).queryByRole('button', { name: /Remove folder/ })).toBeNull();
  act(() => transport.finish([]));
});

it('isolates folder drafts by conversation and clears folders on reset', () => {
  const { result, rerender } = renderHook(({ id }) => useComposer({ conversationId: id }), { initialProps: { id: 'a' } });
  act(() => result.current.addFolders({ folders }));
  rerender({ id: 'b' });
  expect(result.current.folders).toEqual([]);
  act(() => result.current.addFolders({ folders: ['/b'] }));
  rerender({ id: 'a' });
  expect(result.current.folders).toEqual(folders);
  act(() => result.current.reset());
  expect(result.current.folders).toEqual([]);
  rerender({ id: 'b' });
  expect(result.current.folders).toEqual(['/b']);
});

it('keeps folder chips visible while queued and sends their references on the next ordinary turn', async () => {
  const transport = createFakeChatTransport();
  const handle = createRef<ChatPaneComposerHandle>();
  render(<ChatPane transport={transport} agents={agents} composerHandle={handle} initialDraft="First" />);
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(transport.calls).toHaveLength(1));
  act(() => handle.current!.addFolders({ folders }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Second' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  const queued = await screen.findByTestId('chat-pane-queued');
  expect(within(queued).getByRole('button', { name: 'Folders (3)' })).toBeInTheDocument();
  act(() => transport.finish([]));
  await waitFor(() => expect(transport.calls).toHaveLength(2));
  expect(transport.calls[1]?.input.folders).toEqual(folders);
  act(() => transport.finish([]));
});

it('restores refused folders without overwriting folders picked while sending', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<never>((_resolve, no) => { reject = no; });
  const transport = { ...createFakeChatTransport(), startRun: vi.fn(() => pending) };
  const handle = createRef<ChatPaneComposerHandle>();
  render(<ChatPane transport={transport} agents={agents} composerHandle={handle} initialDraft="Inspect" />);
  act(() => handle.current!.addFolders({ folders }));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  act(() => handle.current!.addFolders({ folders: ['/new/pick'] }));
  await act(async () => reject(new Error('refused')));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Folders (4)' })).toBeInTheDocument());
  expect(screen.getByRole('textbox')).toHaveValue('Inspect');
});

it('does not consume a folder picked again while the prior send is awaiting acceptance', async () => {
  const fake = createFakeChatTransport();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const transport = { ...fake, startRun: async (...args: Parameters<typeof fake.startRun>) => { await pending; return fake.startRun(...args); } };
  const handle = createRef<ChatPaneComposerHandle>();
  render(<ChatPane transport={transport} agents={agents} composerHandle={handle} initialDraft="Inspect" />);
  act(() => handle.current!.addFolders({ folders: [folders[0]!] }));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  act(() => handle.current!.addFolders({ folders: [folders[0]!] }));
  await act(async () => release());
  const composer = document.querySelector('.jini-composer')! as HTMLElement;
  const chip = within(composer).getByRole('button', { name: folders[0]! });
  expect(chip).toHaveAttribute('title', folders[0]);
  expect(chip).toHaveTextContent('Folder with spaces');
  act(() => fake.finish([]));
});
