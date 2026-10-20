import { describe, expect, it, vi } from 'vitest';
import { extractFacts } from '../extract-facts.js';
import { createExtractionLog } from '../extraction-log.js';
import type { LlmProviderConfig } from '../llm-provider.js';

const llmConfig: LlmProviderConfig = { provider: 'openai', apiKey: 'key', model: 'model' };

function fixture({ raw, error }: { raw?: string; error?: Error }) {
  const log = createExtractionLog({}, { ids: () => '', now: () => 42, defer: ({ callback }) => callback() });
  const start = vi.spyOn(log, 'startExtraction');
  const provider = vi.spyOn(log, 'markProvider');
  const proposed = vi.spyOn(log, 'markProposed');
  const success = vi.spyOn(log, 'markSuccess');
  const failed = vi.spyOn(log, 'markFailed');
  const fetchFn = vi.fn<typeof fetch>(async () => {
    if (error) throw error;
    return new Response(JSON.stringify({ choices: [{ message: { content: raw } }] }));
  });
  return { log, start, provider, proposed, success, failed, fetchFn };
}

describe('extract-facts L088 characterization', () => {
  it('skips both logging and transport for whitespace input', async () => {
    const f = fixture({ raw: '{}' });
    expect(await extractFacts({ llmConfig, content: ' \n ' }, { llm: { fetchFn: f.fetchFn }, logging: { log: f.log, kind: 'pin' } })).toEqual({ facts: [], raw: '' });
    expect(f.fetchFn).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
  });

  it('logs an empty-string attempt ID, trims content, sanitizes and caps before reporting success', async () => {
    const raw = JSON.stringify({ facts: [null, { statement: ' ' }, { statement: ' fact ', category: ' label ', entities: [' entity ', '', 7], confidence: 2, sourceQuote: ' quote ' }, { statement: 'second' }] });
    const f = fixture({ raw });
    expect(await extractFacts({ llmConfig, content: ' content ' }, {
      llm: { fetchFn: f.fetchFn }, sourceLabel: '', prompt: { systemPrompt: '', maxFacts: 1.9 }, logging: { log: f.log, kind: 'pin' },
    })).toEqual({ facts: [{ statement: 'fact', category: 'label', entities: ['entity'], confidence: 1, sourceQuote: 'quote' }], raw });
    expect(f.start).toHaveBeenCalledWith({ userMessage: 'content', kind: 'pin' });
    expect(f.provider).toHaveBeenCalledWith({ id: '', provider: { kind: 'openai', model: 'model' } });
    expect(f.proposed).toHaveBeenCalledWith({ id: '', proposedCount: 1 });
    expect(f.success).toHaveBeenCalledWith({ id: '', outcome: { writtenCount: 1, writtenIds: [] } });
    expect(f.failed).not.toHaveBeenCalled();
    const init = f.fetchFn.mock.calls[0]![1]!;
    const body: { messages: { content: string }[] } = JSON.parse(String(init.body));
    expect(body.messages).toEqual([{ role: 'system', content: '' }, { role: 'user', content: 'Extract at most 1 facts.\n\nContent:\ncontent' }]);
  });

  it.each([['{}'], ['{"facts":null}'], ['{"facts":"wrong"}'], ['[]'], ['7']])('accepts a non-null JSON response without a facts array: %s', async (raw) => {
    const f = fixture({ raw });
    expect(await extractFacts({ llmConfig, content: 'content' }, { llm: { fetchFn: f.fetchFn } })).toEqual({ facts: [], raw });
  });

  it.each([true, false])('rejects and optionally logs JSON null (logging=%s)', async (logging) => {
    const f = fixture({ raw: 'null' });
    await expect(extractFacts({ llmConfig, content: 'content' }, { llm: { fetchFn: f.fetchFn }, ...(logging ? { logging: { log: f.log, kind: 'pin' } } : {}) })).rejects.toThrow('extract-facts: response must not be null');
    expect(f.failed).toHaveBeenCalledTimes(logging ? 1 : 0);
    expect(f.success).not.toHaveBeenCalled();
    expect(f.proposed).not.toHaveBeenCalled();
    if (logging) expect(f.log.list()[0]?.error).toBe('extract-facts: response must not be null');
  });

  it.each([true, false])('preserves parse failure and optional failure logging (logging=%s)', async (logging) => {
    const f = fixture({ raw: 'bad JSON' });
    await expect(extractFacts({ llmConfig, content: 'content' }, { llm: { fetchFn: f.fetchFn }, ...(logging ? { logging: { log: f.log, kind: 'pin' } } : {}) })).rejects.toThrow('llm-provider: response was not valid JSON: bad JSON');
    expect(f.failed).toHaveBeenCalledTimes(logging ? 1 : 0);
    expect(f.proposed).not.toHaveBeenCalled();
    expect(f.success).not.toHaveBeenCalled();
  });

  it.each([true, false])('preserves transport failure and optional failure logging (logging=%s)', async (logging) => {
    const f = fixture({ error: new Error('network failed') });
    await expect(extractFacts({ llmConfig, content: 'content' }, { llm: { fetchFn: f.fetchFn }, ...(logging ? { logging: { log: f.log, kind: 'pin' } } : {}) })).rejects.toThrow('network failed');
    expect(f.failed).toHaveBeenCalledTimes(logging ? 1 : 0);
    expect(f.proposed).not.toHaveBeenCalled();
    expect(f.success).not.toHaveBeenCalled();
  });
});
