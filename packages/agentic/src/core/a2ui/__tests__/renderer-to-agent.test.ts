import { describe, expect, it } from 'vitest';
import {
  buildActionMessage,
  buildFunctionResponseMessage,
  buildGenericErrorMessage,
  buildValidationFailedMessage,
  parseRendererToAgentMessage,
} from '../renderer-to-agent.js';

describe('renderer -> agent message builders', () => {
  it('builds a spec-shaped action message', () => {
    const msg = buildActionMessage({ name: 'submit', surfaceId: 's1', sourceComponentId: 'btn', timestamp: '2026-01-01T00:00:00.000Z', context: { x: 1 } });
    expect(msg).toEqual({
      version: 'v1.0',
      action: { name: 'submit', surfaceId: 's1', sourceComponentId: 'btn', timestamp: '2026-01-01T00:00:00.000Z', context: { x: 1 } },
    });
    expect(parseRendererToAgentMessage(msg).ok).toBe(true);
  });

  it('builds a spec-shaped functionResponse message', () => {
    const msg = buildFunctionResponseMessage({ functionCallId: 'c1', call: 'greetUser', value: 'hi' });
    expect(parseRendererToAgentMessage(msg).ok).toBe(true);
  });

  it('builds a VALIDATION_FAILED error carrying surfaceId + path', () => {
    const msg = buildValidationFailedMessage('s1', '/components/0/component', 'bad type');
    expect(msg.error).toMatchObject({ code: 'VALIDATION_FAILED', surfaceId: 's1', path: '/components/0/component' });
    expect(parseRendererToAgentMessage(msg).ok).toBe(true);
  });

  it('builds a generic error targeted at a functionCallId (the callFunction-rejection shape)', () => {
    const msg = buildGenericErrorMessage('INVALID_FUNCTION_CALL', 'refused', { functionCallId: 'c1' });
    expect(msg.error).toMatchObject({ code: 'INVALID_FUNCTION_CALL', functionCallId: 'c1' });
    expect(parseRendererToAgentMessage(msg).ok).toBe(true);
  });

  it('builds a generic error targeted at a surfaceId', () => {
    const msg = buildGenericErrorMessage('SOME_ERROR', 'oops', { surfaceId: 's1' });
    expect(parseRendererToAgentMessage(msg).ok).toBe(true);
  });
});

describe('parseRendererToAgentMessage — adversarial', () => {
  it('rejects a non-object payload', () => {
    expect(parseRendererToAgentMessage('nope').ok).toBe(false);
    expect(parseRendererToAgentMessage(null).ok).toBe(false);
  });
  it('rejects a wrong/missing version', () => {
    expect(parseRendererToAgentMessage({ action: {} }).ok).toBe(false);
    expect(parseRendererToAgentMessage({ version: 'v2.0', action: {} }).ok).toBe(false);
  });
  it('rejects zero message-type keys', () => {
    expect(parseRendererToAgentMessage({ version: 'v1.0' }).ok).toBe(false);
  });
  it('rejects two message-type keys at once', () => {
    expect(
      parseRendererToAgentMessage({
        version: 'v1.0',
        action: { name: 'x', surfaceId: 's', sourceComponentId: 'c', timestamp: 't', context: {} },
        functionResponse: { functionCallId: 'c1', call: 'f', value: 1 },
      }).ok,
    ).toBe(false);
  });
  it('rejects an action payload missing required fields', () => {
    expect(parseRendererToAgentMessage({ version: 'v1.0', action: { name: 'x' } }).ok).toBe(false);
  });
  it('rejects a generic error carrying neither surfaceId nor functionCallId', () => {
    expect(parseRendererToAgentMessage({ version: 'v1.0', error: { code: 'E', message: 'm' } }).ok).toBe(false);
  });
  it('rejects a generic error carrying both surfaceId and functionCallId', () => {
    expect(parseRendererToAgentMessage({ version: 'v1.0', error: { code: 'E', message: 'm', surfaceId: 's1', functionCallId: 'c1' } }).ok).toBe(false);
  });
  it('rejects a VALIDATION_FAILED error missing its required path', () => {
    expect(parseRendererToAgentMessage({ version: 'v1.0', error: { code: 'VALIDATION_FAILED', surfaceId: 's1', message: 'm' } }).ok).toBe(false);
  });

  // Regression (2026-07-29 audit), the mirror of the `updateDataModel.value` hole:
  // `renderer_to_agent.json` says `"required": ["functionCallId", "call", "value"]` for
  // functionResponse, and `z.unknown()` accepted a message with no `value` key at all. JSON has
  // no `undefined`, so a function that returns nothing has to say `null`, not say nothing.
  it('rejects a functionResponse with no value at all, which the real schema requires', () => {
    expect(parseRendererToAgentMessage({ version: 'v1.0', functionResponse: { functionCallId: 'c1', call: 'f' } }).ok)
      .toBe(false);
  });

  it('accepts a functionResponse whose value is any legal JSON value, including the falsy ones', () => {
    for (const value of [null, false, 0, '']) {
      expect(parseRendererToAgentMessage({ version: 'v1.0', functionResponse: { functionCallId: 'c1', call: 'f', value } }).ok)
        .toBe(true);
    }
  });
});
