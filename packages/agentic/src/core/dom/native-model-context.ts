import type {
  AgentModelContextLike,
  AgentModelContextRegisterToolOptions,
  AgentModelContextToolRegistration,
} from './model-context.js';

/** The native wire API remains positional; the Jini port uses argument objects. */
interface NativeModelContext {
  registerTool(tool: AgentModelContextToolRegistration, options?: AgentModelContextRegisterToolOptions): Promise<void>;
  unregisterTool?(name: string): void;
}

const adapters = new WeakMap<object, AgentModelContextLike>();

/** Preserve native receiver binding and stable port identity across feature detection. */
export function adaptNativeModelContext({ value }: { value: unknown }): AgentModelContextLike | undefined {
  if (typeof value !== 'object' || value === null || typeof (value as NativeModelContext).registerTool !== 'function') return undefined;
  const existing = adapters.get(value);
  if (existing) return existing;
  const native = value as NativeModelContext;
  const adapter: AgentModelContextLike = {
    registerTool: ({ tool }, options) => native.registerTool(tool, options),
    ...(typeof native.unregisterTool === 'function'
      ? { unregisterTool: ({ name }: { name: string }) => native.unregisterTool!(name) }
      : {}),
  };
  adapters.set(value, adapter);
  return adapter;
}
