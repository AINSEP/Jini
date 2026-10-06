import { expect, it } from 'vitest';
import { providerTurnAdapters, runProviderToolTurn, type ProviderProtocol } from '../tool-turn.js';

const pixels = [{ mimeType: 'image/png', data: 'iVBORw==' }, { mimeType: 'image/png', data: 'iVBOSA==' }];
const expected = {
  anthropic: [{ type: 'text', text: 'colours?' }, ...pixels.map(image => ({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } }))],
  openai: [{ type: 'text', text: 'colours?' }, ...pixels.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }))],
  azure: [{ type: 'text', text: 'colours?' }, ...pixels.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }))],
  google: [{ text: 'colours?' }, ...pixels.map(image => ({ inlineData: image }))],
};
it.each(['anthropic', 'openai', 'azure', 'google'] as const)('preserves both image payloads at the %s provider boundary', async (protocol: ProviderProtocol) => {
  let message: unknown;
  const adapter = async (required: { messages?: readonly { content: unknown }[]; contents?: readonly { parts: unknown }[] }) => {
    message = required.messages?.at(-1)?.content ?? required.contents?.at(-1)?.parts;
    return { toolTurns: 0, stopReason: 'end_turn', finishReason: 'stop' };
  };
  await runProviderToolTurn({ protocol, adapters: { ...providerTurnAdapters, [protocol]: adapter },
    apiKey: 'fixture', model: 'vision-model', system: '', tools: [],
    messages: [{ role: 'user', content: 'colours?', images: pixels }],
    executeTool: async () => ({ content: '' }), onEvent: () => {},
  }, { baseUrl: 'https://example.invalid' });
  expect(message).toEqual(expected[protocol]);
});
