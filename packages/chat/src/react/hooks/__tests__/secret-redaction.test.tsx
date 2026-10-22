import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useConversation } from '../useConversation.js';
import { useChatPane } from '../../features/chat-pane/hooks/useChatPane.hooks.js';
import { ChatPane } from '../../features/chat-pane/components/ChatPane.js';
import { QuestionsPanel } from '../../components/QuestionsPanel.js';
import { QuestionForm } from '../../components/QuestionForm.js';
import { createTypedAnswerPoster } from '../../features/chat-pane/create-typed-answer-poster.js';
import { createFakeChatTransport } from '../testing/fake-transport.js';
import { SECRET_REDACTED_NOTICE, CREDENTIAL_CARD_GUIDANCE } from '../../../core/user-text-redaction.js';
import { JiniChatProvider } from '../../components/JiniChatProvider.js';
const agents = [{ id: 'a', name: 'Agent', available: true }];

it('composer removes credentials before transport, optimistic transcript, and run-context callbacks', async () => {
  const transport = createFakeChatTransport();
  const signals: unknown[] = [];
  const contexts: string[] = [];
  const { result } = renderHook(() => useChatPane({
    transport, agents, initialSelection: { agentId: 'a' }, initialDraft: 'Please save api_key=x',
    onSecretRedacted: signal => signals.push(signal),
    runContext: ({ prompt }) => { contexts.push(prompt); return {}; },
  }));
  await act(() => result.current.send());
  expect(transport.calls[0]?.input.history.map(message => message.content)).toEqual(['Please save api_key=[token removed]']);
  expect(result.current.conversation.messages[0]?.content).toBe('Please save api_key=[token removed]');
  expect(transport.calls[0]?.input.history[0]?.secretRedaction).toEqual({ secretRedacted: true, count: 1 });
  expect(result.current.conversation.messages[0]?.secretRedaction).toEqual({ secretRedacted: true, count: 1 });
  expect(contexts).toEqual(['Please save api_key=[token removed]']);
  expect(signals).toEqual([{ secretRedacted: true, count: 1 }]);
  expect(result.current.secretRedacted).toBe(true);
});

it('queued redaction retains its signal through flush and retry without another notice', async () => {
  const transport = createFakeChatTransport();
  const signals: unknown[] = [];
  const { result } = renderHook(() => useChatPane({ transport, agents, initialSelection: { agentId: 'a' }, onSecretRedacted: signal => signals.push(signal) }));
  await act(() => result.current.sendPrompt('Start'));
  act(() => result.current.composer.setDraft('save api_key=x'));
  await act(() => result.current.send());
  expect(result.current.queuedPrompt).toBe('save api_key=[token removed]');
  await act(async () => transport.finish());
  expect(transport.calls).toHaveLength(2);
  expect(transport.calls[1]?.input.history.at(-1)?.secretRedaction).toEqual({ secretRedacted: true, count: 1 });
  expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('save api_key=[token removed]');
  act(() => transport.fail(new Error('offline')));
  await act(() => result.current.conversation.retry(result.current.conversation.messages.at(-1)!.id));
  expect(transport.calls[2]?.input.history.at(-1)?.secretRedaction).toEqual({ secretRedacted: true, count: 1 });
  expect(signals).toEqual([{ secretRedacted: true, count: 1 }]);
});

it('queued and interrupt sends retain only sanitized prompts', async () => {
  const transport = createFakeChatTransport();
  const { result } = renderHook(() => useChatPane({ transport, agents, initialSelection: { agentId: 'a' } }));
  await act(() => result.current.sendPrompt('Start'));
  act(() => result.current.composer.setDraft('save api_key=x'));
  await act(() => result.current.send());
  expect(result.current.queuedPrompt).toBe('save api_key=[token removed]');
  act(() => { result.current.cancelQueued(); result.current.composer.setDraft('save password=y'); });
  act(() => result.current.interruptSend());
  expect(result.current.queuedPrompt ?? transport.calls.at(-1)?.input.history.at(-1)?.content).toBe('save password=[token removed]');
});

it('typed answer poster sends only sanitized text and exposes a count', async () => {
  const bodies: string[] = [];
  const signals: unknown[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => { bodies.push(String(init?.body)); return new Response(null, { status: 202 }); };
  const post = createTypedAnswerPoster({ baseUrl: '', fetch, toolName: 'ask_choice' }, { onSecretRedacted: signal => signals.push(signal) });
  expect(await post({ text: 'api_key=x' })).toBe('delivered');
  expect(bodies).toEqual([JSON.stringify({ toolName: 'ask_choice', params: { __typedAnswer: 'api_key=[token removed]' } })]);
  expect(signals).toEqual([{ secretRedacted: true, count: 1 }]);
});

it('sensitive question text is masked and no raw answer escapes submit or draft callbacks', () => {
  const calls: { text: string; answers: unknown }[] = [];
  const drafts: unknown[] = [];
  const changes: unknown[] = [];
  const signals: unknown[] = [];
  const form = { id: 'f', title: 'Question', questions: [{ id: 'q', name: 'accessToken', label: 'Access', type: 'text' as const, defaultValue: 'model-prefill' }] };
  const { container } = render(<QuestionForm form={form} interactive onDraftChange={answers => drafts.push(answers)} onAnswerChange={(_id, value) => changes.push(value)} onSecretRedacted={signal => signals.push(signal)} onSubmit={(text, answers) => calls.push({ text, answers })} />);
  const input = container.querySelector('input')!;
  expect(input.type).toBe('password');
  expect(input.value).toBe('');
  expect(input.autocomplete).toBe('new-password');
  fireEvent.change(input, { target: { value: 'short-passphrase' } });
  expect(drafts).toEqual([{ q: '[token removed]' }]);
  expect(changes).toEqual(['[token removed]']);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(calls).toEqual([{ text: '[form answers — f]\n- Access: [token removed]\n' + CREDENTIAL_CARD_GUIDANCE, answers: { q: '[token removed]' } }]);
  expect(signals).toEqual([{ secretRedacted: true, count: 1 }]);
  expect(screen.getByRole('status').textContent).toBe(SECRET_REDACTED_NOTICE);
});

it('ordinary labelled answers still pass secret-shaped pasted text through the guard', () => {
  const answers: unknown[] = [];
  render(<QuestionForm form={{ id: 'f', title: 'Question', questions: [{ id: 'notes', label: 'Notes', type: 'text' }] }} interactive onSubmit={(_text, values) => answers.push(values)} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'api_key=x' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(answers).toEqual([{ notes: 'api_key=[token removed]' }]);
});

it('pane notice uses the host translator and exposes only safe metadata to open a card', async () => {
  const transport = createFakeChatTransport();
  const signals: unknown[] = [];
  render(<JiniChatProvider transport={transport} i18n={{ locale: 'es', t: key => key === SECRET_REDACTED_NOTICE ? 'Aviso seguro' : key }}><ChatPane transport={transport} agents={agents} initialSelection={{ agentId: 'a' }} initialDraft="api_key=x" onSecretRedacted={signal => signals.push(signal)} /></JiniChatProvider>);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  expect(screen.getByText('Aviso seguro').textContent).toBe('Aviso seguro');
  expect(signals).toEqual([{ secretRedacted: true, count: 1 }]);
});

it('direct conversation sends and retries sanitize legacy user history before transport', async () => {
  const transport = createFakeChatTransport();
  const initialMessages = [{ id: 'old', role: 'user' as const, content: 'old api_key=x' }];
  const { result } = renderHook(() => useConversation({ transport, initialMessages }));
  await act(() => result.current.sendMessage('new password=y'));
  expect(transport.calls[0]?.input.history.map(message => message.content)).toEqual(['old api_key=[token removed]', 'new password=[token removed]']);
  expect(result.current.messages.at(-2)?.content).toBe('new password=[token removed]');
  act(() => transport.fail(new Error('offline')));
  await act(() => result.current.retry(result.current.messages.at(-1)!.id));
  expect(transport.calls[1]?.input.history.map(message => message.content)).toEqual(['old api_key=[token removed]', 'new password=[token removed]']);
});

it('question panel forwards the card-opening callback with only a safe count', () => {
  const signals: unknown[] = [];
  const answers: unknown[] = [];
  const { container } = render(<QuestionsPanel form={{ id: 'f', title: 'Question', questions: [{ id: 'token', label: 'Token', type: 'text' }] }} interactive onSecretRedacted={signal => signals.push(signal)} onSubmit={(_text, values) => answers.push(values)} />);
  fireEvent.change(container.querySelector('input')!, { target: { value: 'short' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(signals).toEqual([{ secretRedacted: true, count: 1 }]);
  expect(answers).toEqual([{ token: '[token removed]' }]);
});

it('composer guards a host-provided typed-answer delivery before invoking it', async () => {
  const transport = createFakeChatTransport();
  const texts: string[] = [];
  const deliverTypedAnswer = Object.assign(async ({ text }: { text: string }) => { texts.push(text); return 'delivered' as const; }, { toolName: 'ask_choice' });
  const { result } = renderHook(() => useChatPane({ transport, agents, initialSelection: { agentId: 'a' }, deliverTypedAnswer }));
  await act(() => result.current.sendPrompt('Start'));
  act(() => {
    transport.emit({ kind: 'tool_use', id: 'ask-1', name: 'ask_choice', input: {} });
    transport.emit({ kind: 'ext', name: 'mcp-ui', data: { uri: 'ui://ask/1' } });
  });
  act(() => result.current.composer.setDraft('save api_key=x'));
  await act(() => result.current.send());
  expect(texts).toEqual(['save api_key=[token removed]']);
  expect(transport.calls).toHaveLength(1);
  expect(result.current.queuedPrompt).toBeNull();
  expect(result.current.secretRedacted).toBe(true);
});
