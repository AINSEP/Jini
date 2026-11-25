import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement, Fragment, isValidElement, type ReactElement } from 'react';
import { expect, it } from 'vitest';
import { defaultConversationListHooks } from '../../../components/ConversationList.js';
import { ConversationChatPane } from '../components/ConversationChatPane.js';
import { useConversationChatPane } from '../hooks/useConversationChatPane.hooks.js';
import { selectionRunContext } from '../rules.js';
import type { ConversationChatPaneComponents } from '../types.js';
import { fakeHooks, LABELS, pathOf, type PaneFakes } from './fixtures.js';

/** Mount the pane with recording stand-ins for `ConversationList` and `ChatPane`. */
function renderPane(fakes: PaneFakes = {}) {
  const fake = fakeHooks(fakes);
  const rendered: { list?: Record<string, unknown>; chat?: Record<string, unknown> } = {};
  const components = {
    ConversationList: (props: Record<string, unknown>) => { rendered.list = props; return null; },
    ChatPane: (props: Record<string, unknown>) => { rendered.chat = props; return createElement('textarea', { placeholder: props.placeholder as string }); },
  } as unknown as ConversationChatPaneComponents;
  const view = render(
    <ConversationChatPane conversationListHooks={defaultConversationListHooks} onClose={() => fake.calls.push('close')} labels={LABELS} variant="workspace" components={components} useConversationChatPaneHook={useConversationChatPane} {...fake.hooks} />,
  );
  return { ...view, fake, rendered, calls: fake.calls };
}

it('without a transport the pane says why there is no chat, and renders neither chat component', () => {
  const { container, rendered, calls } = renderPane({ connected: false });
  expect(container.querySelector('aside[aria-label="L-pane"]')).not.toBeNull();
  expect(container.querySelector('.jini-conversation-chat-pane__status')?.textContent?.trim()).toBe('L-unavailable');
  expect(rendered).toEqual({});
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'L-close' }));
  expect(calls).toEqual(['close']);
});

it("with a transport the switcher and the chat pane get the hook state, under the pane's own header", () => {
  const { container, rendered, fake } = renderPane();
  expect(container.querySelector('.jini-conversation-chat-pane__status')).toBeNull();
  const { list, chat } = rendered;
  expect(list?.conversations).toEqual([{ id: 'c1', title: 'Fleet triage' }, { id: 'c2', title: 'Deploy check' }]);
  expect(list?.activeConversationId).toBe('c1');
  expect(list?.hooks).toBe(defaultConversationListHooks);
  expect(list?.onSelect).toBe(fake.conversations.select);
  expect(list?.onCreate).toBe(fake.conversations.create);
  expect(list?.onDelete).toBe(fake.conversations.remove);
  expect(list?.onRename).toBe(fake.conversations.rename);
  expect(list?.confirmDelete).toBe(fake.deleteConfirmation.confirmDelete);
  expect(chat?.transport).toBe(fake.transport.transport);
  expect(chat?.runtimeAccess).toBe(fake.runtimeAccess);
  expect(chat?.runContext).toBe(selectionRunContext);
  expect(chat?.conversationId).toBe('c1');
  expect(chat?.initialMessages).toBe(fake.conversations.initialMessages);
  expect(chat?.onMessagesChange).toBe(fake.conversations.onMessagesChange);
  expect(chat?.variant).toBe('workspace');
  expect(chat?.workingDirectory).toBeNull();
  expect(chat?.uploadAttachments).toBe(fake.transport.uploadAttachments);
  // An empty fragment, not `undefined`: `ChatPane` falls back to its own default header on `undefined`.
  expect(isValidElement(chat?.header) && (chat?.header as ReactElement).type === Fragment).toBe(true);
  expect(container.querySelector('textarea')?.getAttribute('placeholder')).toBe('L-placeholder');
  expect(container.querySelector('.jini-conversation-chat-pane__head h2')?.textContent).toBe('L-title');
});

it('the working directory the chat pane picks is held by the pane and handed back on the next render', () => {
  const { rendered } = renderPane();
  act(() => (rendered.chat?.onChangeWorkingDirectory as (dir: string) => void)('/Users/x/Site'));
  expect(rendered.chat?.workingDirectory).toBe('/Users/x/Site');
});

it('a pending delete renders an inline confirmation whose buttons answer it', () => {
  const { container, calls } = renderPane({ pendingTitle: 'Fleet triage' });
  const dialog = container.querySelector('[role="alertdialog"][aria-label="L-confirm"]');
  expect(dialog?.querySelector('p')?.textContent?.trim()).toBe('L-delete-prompt:Fleet triage');
  fireEvent.click(screen.getByRole('button', { name: 'L-cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'L-delete' }));
  expect(calls).toEqual(['resolve:false', 'resolve:true']);
});

it('a folder dropped anywhere on the pane is swallowed and its path written into the composer the chat pane was handed', () => {
  // The pane hands `ChatPane` the composer handle and catches drops on its own `<aside>`; both halves
  // must reach the same handle, or a correct folder-drop rule would simply never be called.
  const { container, rendered } = renderPane({ getPathForFile: pathOf });
  const inserted: string[] = [];
  (rendered.chat?.composerHandle as { current: unknown }).current = { insertText: (text: string) => void inserted.push(text) };
  const drop = Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
    dataTransfer: { items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }], files: [{ path: '/Users/x/Site' }] },
  });
  act(() => { container.querySelector('textarea')!.dispatchEvent(drop); });
  expect(inserted).toEqual(['/Users/x/Site']);
  expect(drop.defaultPrevented).toBe(true);
});

it('every visible string comes from labels; the pane renders no built-in product copy', () => {
  const connected = renderPane({ pendingTitle: 'T' });
  const disconnected = renderPane({ connected: false });
  for (const { container } of [connected, disconnected]) {
    const texts = [...container.querySelectorAll('*')].flatMap((el) => [...el.childNodes])
      .filter((node) => node.nodeType === 3 && node.textContent!.trim() !== '').map((node) => node.textContent!.trim());
    expect(texts.every((text) => text.startsWith('L-'))).toBe(true);
    for (const el of container.querySelectorAll('[aria-label],[placeholder]')) {
      expect((el.getAttribute('aria-label') ?? el.getAttribute('placeholder'))!.startsWith('L-')).toBe(true);
    }
    expect([...container.querySelectorAll('[class]')].every((el) => [...el.classList].every((c) => c.startsWith('jini-')))).toBe(true);
  }
});
