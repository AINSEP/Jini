/** `ai-trace-langfuse`: setup only registers the factory; the Langfuse client is built when a host initializes it. */
import type { PluginSdk } from '@jini-ai/plugins/host';
import { createLangfuseAiTraceSink, createLangfuseClient, type LangfuseClientPort } from './langfuse.js';
import { attributionOf } from '../attribution.js';

function textOf(value: unknown, name: string, { required }: { required: boolean }): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

/**
 * Builds the configured sink. Hosts wrap it in the agent-runtime fan-out with any local sink.
 * @param required `{ publicKey, secretKey, baseUrl?, environment?, release? }` from secure plugin settings.
 * @param optional `{ client? }`: a borrowed client (tests: a recording one, never a live call); never closed here.
 * @returns `{ port: AiTraceSink, dispose }`; dispose shuts down a factory-built client, and only flushes a borrowed one.
 * @throws TypeError on missing keys or malformed optional strings.
 */
export function createLangfuseProvider(required: Readonly<Record<string, unknown>>, optional: Readonly<Record<string, unknown>> = {}) {
  const config = { publicKey: textOf(required.publicKey, 'publicKey', { required: true })!, secretKey: textOf(required.secretKey, 'secretKey', { required: true })! };
  const extras = Object.fromEntries((['baseUrl', 'environment', 'release'] as const)
    .map((name) => [name, textOf(required[name], name, { required: false })] as const).filter(([, value]) => value !== undefined));
  const borrowed = optional.client as LangfuseClientPort | undefined;
  const client = borrowed ? borrowedView({ client: borrowed }) : createLangfuseClient({ ...config, ...extras });
  const port = createLangfuseAiTraceSink({ client, attribution: attributionOf(required.attribution) });
  return { port, dispose: async (_required: Record<string, never>, _optional: Record<string, never> = {}) => { await client.shutdownAsync(); } };
}

/**
 * A resource owns only what its factory created (`PluginProviderResource`): a host-supplied client may
 * serve other consumers, so closing this provider (dispose, or the sink's own `shutdown`) only flushes it.
 */
function borrowedView({ client }: { client: LangfuseClientPort }): LangfuseClientPort {
  return {
    trace: (body) => client.trace(body), generation: (body) => client.generation(body), span: (body) => client.span(body),
    flushAsync: () => client.flushAsync(), shutdownAsync: () => client.flushAsync(),
  };
}

export default {
  definition: {
    setup(sdk: PluginSdk): void {
      sdk.providers.register({ contract: 'ai_trace', id: 'langfuse', contractVersion: 1, factory: createLangfuseProvider });
    },
  },
};
