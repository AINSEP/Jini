import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../core/messages.js';
import type { AssistantConversation } from '../../../core/assistant-client/messages.js';
import { createAssistantChatsClient } from '../assistant-chats.js';
import type { AssistantChatsPort, SaveOutcome } from '../assistant-chats-contracts.js';

/**
 * The assistant-chats client's pure decisions: how a write failure is classified, what one attempt
 * concludes, and what a settled batch or the mount-time list read means. Every outside effect the
 * client has (status extraction, sleeping, reporting a dropped message) is a port, so these are
 * driven with hand-written fakes and no React at all.
 */
class StatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

function makeClient() {
  const sleep = vi.fn(async (_required: { delayMs: number }) => {});
  const reportPermanent = vi.fn();
  const client = createAssistantChatsClient({ ports: {
    statusOf: ({ error }) => (error instanceof StatusError ? error.status : undefined),
    sleep,
    reportPermanent,
    requestRunPrefixes: ['byok:'],
  } });
  return { client, sleep, reportPermanent };
}

const message: ChatMessage = { id: 'm1', role: 'user', content: 'hi' };
const live = () => false;

describe('giveUpOutcome', () => {
  it('classifies a 404 as missing and anything else as exhausted', () => {
    const { client } = makeClient();
    expect(client.giveUpOutcome({ error: new StatusError(404) })).toBe('missing');
    expect(client.giveUpOutcome({ error: new StatusError(503) })).toBe('exhausted');
    expect(client.giveUpOutcome({ error: new Error('offline') })).toBe('exhausted');
  });
});

describe('handleSaveFailure', () => {
  const input = (error: unknown, attempt = 0, isDisposed = live) => ({ error, conversationId: 'c1', message, attempt, isDisposed });

  it.each([400, 403, 422])('reports a %i as permanent without sleeping', async (status) => {
    const { client, sleep, reportPermanent } = makeClient();
    const error = new StatusError(status);
    await expect(client.handleSaveFailure(input(error))).resolves.toEqual({ done: true, outcome: 'permanent' });
    expect(reportPermanent).toHaveBeenCalledWith({ conversationId: 'c1', messageId: 'm1', error }, {});
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up as exhausted, without sleeping, on a status that is neither transient nor a client error', async () => {
    const { client, sleep, reportPermanent } = makeClient();
    await expect(client.handleSaveFailure(input(new StatusError(302)))).resolves.toEqual({ done: true, outcome: 'exhausted' });
    expect(sleep).not.toHaveBeenCalled();
    expect(reportPermanent).not.toHaveBeenCalled();
  });

  it.each([
    ['a 429', new StatusError(429)],
    ['a 5xx', new StatusError(503)],
    ['a 404', new StatusError(404)],
    ['a failure with no status', new TypeError('Failed to fetch')],
  ])('sleeps the ladder delay and asks for another attempt on %s', async (_label, error) => {
    const { client, sleep } = makeClient();
    await expect(client.handleSaveFailure(input(error, 1))).resolves.toEqual({ done: false });
    expect(sleep).toHaveBeenCalledWith({ delayMs: 3_000 }, {});
  });

  it('gives up once the ladder is spent, reporting a 404 as missing', async () => {
    const { client, sleep } = makeClient();
    await expect(client.handleSaveFailure(input(new StatusError(503), 3))).resolves.toEqual({ done: true, outcome: 'exhausted' });
    await expect(client.handleSaveFailure(input(new StatusError(404), 3))).resolves.toEqual({ done: true, outcome: 'missing' });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up without sleeping when already disposed', async () => {
    const { client, sleep } = makeClient();
    await expect(client.handleSaveFailure(input(new StatusError(503), 0, () => true))).resolves.toEqual({ done: true, outcome: 'exhausted' });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after the sleep when torn down mid-backoff', async () => {
    const { client, sleep } = makeClient();
    let disposed = false;
    sleep.mockImplementationOnce(async () => { disposed = true; });
    await expect(client.handleSaveFailure(input(new StatusError(404), 0, () => disposed))).resolves.toEqual({ done: true, outcome: 'missing' });
    expect(sleep).toHaveBeenCalledWith({ delayMs: 1_000 }, {});
  });
});

describe('attemptSave', () => {
  function portSaving(saveMessage: AssistantChatsPort['saveMessage']): AssistantChatsPort {
    const unused = async () => { throw new Error('not used'); };
    return { listConversations: unused, createConversation: unused, renameConversation: unused, deleteConversation: unused, loadMessages: unused, saveMessage };
  }

  it('is done and saved once the port write resolves', async () => {
    const { client } = makeClient();
    const save = vi.fn(async () => {});
    await expect(client.attemptSave({ port: portSaving(save), conversationId: 'c1', message, attempt: 0, isDisposed: live })).resolves.toEqual({ done: true, outcome: 'saved' });
    expect(save).toHaveBeenCalledWith({ conversationId: 'c1', message }, {});
  });

  it('resolves (never rejects) with the classified failure when the write throws', async () => {
    const { client } = makeClient();
    const port = portSaving(async () => { throw new StatusError(400); });
    await expect(client.attemptSave({ port, conversationId: 'c1', message, attempt: 0, isDisposed: live })).resolves.toEqual({ done: true, outcome: 'permanent' });
  });
});

describe('summarizeFlushOutcomes', () => {
  const m = (id: string, runId?: string): ChatMessage => ({ id, role: 'assistant', content: '', ...(runId ? { runId } : {}) });
  const batch = (...outcomes: SaveOutcome[]) => outcomes.map((outcome, i) => ({ message: m(`m${i}`, i === 1 ? 'r1' : undefined), outcome }));

  it('releases exhausted and missing write keys only, keyed with the run id when there is one', () => {
    const { client } = makeClient();
    const { idsToRelease } = client.summarizeFlushOutcomes({ results: batch('exhausted', 'missing', 'saved', 'permanent'), isConversationStillActive: true });
    expect(idsToRelease).toEqual(['m0', 'm1:r1']);
  });

  it('refreshes when anything saved, or on a missing outcome only while the conversation is active', () => {
    const { client } = makeClient();
    expect(client.summarizeFlushOutcomes({ results: batch('saved'), isConversationStillActive: false }).shouldRefresh).toBe(true);
    expect(client.summarizeFlushOutcomes({ results: batch('exhausted', 'missing'), isConversationStillActive: true }).shouldRefresh).toBe(true);
    expect(client.summarizeFlushOutcomes({ results: batch('exhausted', 'missing'), isConversationStillActive: false }).shouldRefresh).toBe(false);
    expect(client.summarizeFlushOutcomes({ results: batch('permanent', 'exhausted'), isConversationStillActive: true }).shouldRefresh).toBe(false);
    expect(client.summarizeFlushOutcomes({ results: [], isConversationStillActive: true })).toEqual({ idsToRelease: [], shouldRefresh: false });
  });
});

describe('resolveRememberedConversation', () => {
  const conv = (id: string): AssistantConversation => ({ id, title: null, titleSource: 'fallback', messageCount: 0, createdAt: 0, updatedAt: 0 });

  it('restores a remembered conversation that is still listed', () => {
    const { client } = makeClient();
    expect(client.resolveRememberedConversation({ remembered: 'b', conversations: [conv('a'), conv('b')], listFailed: false })).toBe('restore');
  });

  it('forgets one the list no longer contains', () => {
    const { client } = makeClient();
    expect(client.resolveRememberedConversation({ remembered: 'gone', conversations: [conv('a')], listFailed: false })).toBe('forget');
  });

  it('keeps the memory when nothing is remembered or the list read failed', () => {
    const { client } = makeClient();
    expect(client.resolveRememberedConversation({ remembered: null, conversations: [conv('a')], listFailed: false })).toBe('keep');
    expect(client.resolveRememberedConversation({ remembered: 'a', conversations: [], listFailed: true })).toBe('keep');
  });
});
