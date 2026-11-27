import { act, renderHook } from '@testing-library/react';
import type { DragEvent } from 'react';
import { expect, it } from 'vitest';
import { useConversationChatPane } from '../hooks/useConversationChatPane.hooks.js';
import { fakeHooks, folderDrop, pathOf } from './fixtures.js';

it('the pane state passes its collaborators through and derives the conversation view', () => {
  const fake = fakeHooks();
  const { result } = renderHook(() => useConversationChatPane(fake.hooks));
  const pane = result.current;
  expect(pane.transport).toBe(fake.transport.transport);
  expect(pane.runtimeAccess).toBe(fake.transport.runtimeAccess);
  expect(pane.workingDirectoryAccess).toBe(fake.transport.workingDirectoryAccess);
  expect(pane.uploadAttachments).toBe(fake.transport.uploadAttachments);
  expect(pane.conversations).toBe(fake.conversations);
  expect(pane.deleteConfirmation).toBe(fake.deleteConfirmation);
  expect(pane.listItems).toEqual([{ id: 'c1', title: 'Fleet triage' }, { id: 'c2', title: 'Deploy check' }]);
  expect(pane.conversationIdProp).toEqual({ conversationId: 'c1' });
  expect(pane.workingDirectory).toBeNull();
  act(() => pane.setWorkingDirectory('/Users/x/Site'));
  expect(result.current.workingDirectory).toBe('/Users/x/Site');
  expect(result.current.composerHandle).toBe(pane.composerHandle);
});

it('a folder dropped on the pane is written into the composer the ChatPane published', () => {
  const fake = fakeHooks({ getPathForFile: pathOf });
  const { result } = renderHook(() => useConversationChatPane(fake.hooks));
  const inserted: string[] = [];
  result.current.composerHandle.current = { insertText: (text: string) => void inserted.push(text) } as never;
  const calls: string[] = [];
  result.current.onDropCapture(folderDrop({ path: '/Users/x/Site' }, calls) as unknown as DragEvent<HTMLElement>);
  expect(calls).toEqual(['preventDefault', 'stopPropagation']);
  expect(inserted).toEqual(['/Users/x/Site']);
});

it('a dropped folder whose path contains a space is inserted quoted', () => {
  const fake = fakeHooks({ getPathForFile: pathOf });
  const { result } = renderHook(() => useConversationChatPane(fake.hooks));
  const inserted: string[] = [];
  result.current.composerHandle.current = { insertText: (text: string) => void inserted.push(text) } as never;
  result.current.onDropCapture(folderDrop({ path: '/Users/x/My Site' }) as unknown as DragEvent<HTMLElement>);
  expect(inserted).toEqual(['"/Users/x/My Site"']);
});

it('leaves drops available to the host when there is no file-to-path port', () => {
  const fake = fakeHooks();
  const { result } = renderHook(() => useConversationChatPane(fake.hooks));
  const calls: string[] = [];
  result.current.onDropCapture(folderDrop({ path: '/Users/x/Site' }, calls) as unknown as DragEvent<HTMLElement>);
  expect(calls).toEqual([]);
  expect(result.current.composerHandle.current).toBeNull();
});
