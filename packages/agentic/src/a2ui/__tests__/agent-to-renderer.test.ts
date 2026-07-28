import { describe, expect, it } from 'vitest';
import { parseAgentToRendererMessage } from '../agent-to-renderer.js';

describe('parseAgentToRendererMessage — valid envelopes', () => {
  it('parses a minimal createSurface message', () => {
    const result = parseAgentToRendererMessage({ version: 'v1.0', createSurface: { surfaceId: 's1', catalogId: 'cat' } });
    expect(result.ok).toBe(true);
  });

  it('parses createSurface with initial components and dataModel', () => {
    const result = parseAgentToRendererMessage({
      version: 'v1.0',
      createSurface: {
        surfaceId: 's1',
        catalogId: 'cat',
        components: [{ id: 'root', component: 'Text', text: 'hi' }],
        dataModel: { a: 1 },
        sendDataModel: true,
      },
    });
    expect(result.ok).toBe(true);
  });

  it('parses updateComponents', () => {
    const result = parseAgentToRendererMessage({
      version: 'v1.0',
      updateComponents: { surfaceId: 's1', components: [{ id: 'root', component: 'Text', text: 'hi' }] },
    });
    expect(result.ok).toBe(true);
  });

  it('parses updateDataModel with and without an explicit path', () => {
    expect(parseAgentToRendererMessage({ version: 'v1.0', updateDataModel: { surfaceId: 's1', value: { a: 1 } } }).ok).toBe(true);
    expect(parseAgentToRendererMessage({ version: 'v1.0', updateDataModel: { surfaceId: 's1', path: '/a', value: 1 } }).ok).toBe(true);
  });

  it('parses deleteSurface', () => {
    expect(parseAgentToRendererMessage({ version: 'v1.0', deleteSurface: { surfaceId: 's1' } }).ok).toBe(true);
  });

  it('parses callFunction', () => {
    const result = parseAgentToRendererMessage({
      version: 'v1.0',
      functionCallId: 'call-1',
      callFunction: { call: 'greetUser', args: { name: 'Ada' } },
    });
    expect(result.ok).toBe(true);
  });

  it('parses actionResponse with a value, and separately with an error', () => {
    expect(parseAgentToRendererMessage({ version: 'v1.0', actionId: 'a1', actionResponse: { value: 42 } }).ok).toBe(true);
    expect(parseAgentToRendererMessage({ version: 'v1.0', actionId: 'a1', actionResponse: { error: { code: 'E', message: 'bad' } } }).ok).toBe(true);
  });
});

describe('parseAgentToRendererMessage — adversarial / malformed envelopes', () => {
  it('rejects an envelope missing version entirely', () => {
    const result = parseAgentToRendererMessage({ deleteSurface: { surfaceId: 's1' } });
    expect(result).toMatchObject({ ok: false, code: 'MISSING_VERSION' });
  });

  it('rejects an envelope with an unsupported version string', () => {
    const result = parseAgentToRendererMessage({ version: 'v0.9', deleteSurface: { surfaceId: 's1' } });
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_VERSION' });
  });

  it('rejects an envelope with no recognized message-type key ("wrong message-type key")', () => {
    const result = parseAgentToRendererMessage({ version: 'v1.0', totallyUnknownKey: {} });
    expect(result).toMatchObject({ ok: false, code: 'NO_MESSAGE_KEY' });
  });

  it('rejects an envelope with two message-type keys at once (ambiguous)', () => {
    const result = parseAgentToRendererMessage({
      version: 'v1.0',
      deleteSurface: { surfaceId: 's1' },
      createSurface: { surfaceId: 's2', catalogId: 'cat' },
    });
    expect(result).toMatchObject({ ok: false, code: 'AMBIGUOUS_MESSAGE' });
  });

  it('rejects createSurface missing its required catalogId', () => {
    const result = parseAgentToRendererMessage({ version: 'v1.0', createSurface: { surfaceId: 's1' } });
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('rejects an envelope carrying an extra, unknown top-level field alongside a valid message', () => {
    const result = parseAgentToRendererMessage({ version: 'v1.0', deleteSurface: { surfaceId: 's1' }, extraJunk: true });
    // "extraJunk" is not one of the 6 known keys, so this is 2 "present keys" by this dispatcher's
    // own reckoning only if extraJunk happened to collide with a known key name (it doesn't) — the
    // real rejection path here is the outer envelope being `.strict()`... but since the dispatcher
    // narrows to deleteSurface's own schema, the extra key is caught by *that* schema's `.strict()`.
    expect(result.ok).toBe(false);
  });

  it('rejects a message body with an unknown extra field (closed schema, e.g. deleteSurface.bogus)', () => {
    const result = parseAgentToRendererMessage({ version: 'v1.0', deleteSurface: { surfaceId: 's1', bogus: true } });
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('rejects a raw envelope that is not an object at all', () => {
    expect(parseAgentToRendererMessage('not an object').ok).toBe(false);
    expect(parseAgentToRendererMessage(null).ok).toBe(false);
    expect(parseAgentToRendererMessage([1, 2, 3]).ok).toBe(false);
  });

  it('rejects createSurface with an empty components array (minItems: 1 on the real schema)', () => {
    const result = parseAgentToRendererMessage({ version: 'v1.0', createSurface: { surfaceId: 's1', catalogId: 'cat', components: [] } });
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('rejects actionResponse carrying both value and error at once', () => {
    const result = parseAgentToRendererMessage({ version: 'v1.0', actionId: 'a1', actionResponse: { value: 1, error: { code: 'E', message: 'm' } } });
    expect(result.ok).toBe(false);
  });
});
