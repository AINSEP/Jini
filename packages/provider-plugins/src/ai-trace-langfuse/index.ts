/** `ai-trace-langfuse`: setup only registers the factory; the Langfuse client is built when a host initializes it. */
import type { PluginSdk } from '@jini-ai/plugins/host';
import { createLangfuseAiTraceSink, createLangfuseClient, type LangfuseClientPort } from './langfuse.js';

function textOf(value: unknown, name: string, { required }: { required: boolean }): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

/**
 * Builds the configured sink. Hosts wrap it in the agent-runtime fan-out with any local sink.
 * @param required `{ publicKey, secretKey, baseUrl?, environment?, release? }` from secure plugin settings.
 * @param optional `{ client? }`: a recording client for tests (never a live call).
 * @returns `{ port: AiTraceSink, dispose }`; dispose flushes and shuts the client down.
 * @throws TypeError on missing keys or malformed optional strings.
 */
export function createLangfuseProvider(required: Readonly<Record<string, unknown>>, optional: Readonly<Record<string, unknown>> = {}) {
  const config = { publicKey: textOf(required.publicKey, 'publicKey', { required: true })!, secretKey: textOf(required.secretKey, 'secretKey', { required: true })! };
  const extras = Object.fromEntries((['baseUrl', 'environment', 'release'] as const)
    .map((name) => [name, textOf(required[name], name, { required: false })] as const).filter(([, value]) => value !== undefined));
  const client = (optional.client as LangfuseClientPort | undefined) ?? createLangfuseClient({ ...config, ...extras });
  const port = createLangfuseAiTraceSink({ client });
  return { port, dispose: async (_required: Record<string, never>, _optional: Record<string, never> = {}) => { await client.shutdownAsync(); } };
}

export default {
  definition: {
    setup(sdk: PluginSdk): void {
      sdk.providers.register({ contract: 'ai_trace', id: 'langfuse', contractVersion: 1, factory: createLangfuseProvider });
    },
  },
};
