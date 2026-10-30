/** agy's documented stream-json protocol, distinct from Gemini CLI's legacy wire format.
 * https://antigravity.google/docs/cli/headless/#tool-calls-in-the-stream */
type Frame = Record<string, unknown>;
type Emit = (event: Frame) => void;

export interface AntigravityStreamState {
  textEmitted: boolean;
  toolUses: Set<string>;
  toolResults: Set<string>;
}

function record(value: unknown): Frame {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Frame : {};
}

/** Native edits record paths, never patches or complete document contents. */
function nativeTool({ name, parameters }: { name: string; parameters: Frame }, _options = {}) {
  if (name === 'run_command') return { name: 'Bash', input: { command: parameters.CommandLine } };
  if (name === 'write_to_file') return { name: 'Write', input: { file_path: parameters.TargetFile } };
  if (name === 'replace_file_content' || name === 'multi_replace_file_content') {
    return { name: 'Edit', input: { file_path: parameters.TargetFile } };
  }
  return { name, input: parameters };
}

/** ACTIVE and DONE can describe the same call; a DONE-only receipt must also be audited. */
function toolStep({ step, emit, state }: { step: Frame; emit: Emit; state: AntigravityStreamState }, _options = {}) {
  if (typeof step.conversation_id !== 'string' || typeof step.step_index !== 'number') return;
  const info = record(step.tool_info);
  const name = info.name ?? step.tool_name;
  if (typeof name !== 'string') return;
  // A tool-name-only ACTIVE frame cannot supply the command/path yet; wait for its receipt.
  if (info.parameters === undefined && step.state !== 'DONE') return;
  const id = `${step.conversation_id}:${step.step_index}`;
  if (!state.toolUses.has(id)) {
    state.toolUses.add(id);
    emit({ type: 'tool_use', id, ...nativeTool({ name, parameters: record(info.parameters) }) });
  }
  toolResult({ step, info, id, emit, state });
}

function toolResult({ step, info, id, emit, state }: {
  step: Frame; info: Frame; id: string; emit: Emit; state: AntigravityStreamState;
}, _options = {}) {
  if (step.state !== 'DONE' || state.toolResults.has(id)) return;
  state.toolResults.add(id);
  const error = record(info.error);
  const content = typeof error.message === 'string' ? error.message : info.output;
  emit({ type: 'tool_result', toolUseId: id, content: typeof content === 'string' ? content : '',
    isError: info.error !== undefined && info.error !== null });
}

function responseText({ text, emit, state }: { text: unknown; emit: Emit; state: AntigravityStreamState }, _options = {}) {
  if (typeof text !== 'string' || text.length === 0) return;
  state.textEmitted = true;
  emit({ type: 'text_delta', delta: text });
}

/** The terminal response repeats streamed deltas. Errors must survive even on exit zero. */
function terminalResult({ result, emit, state }: { result: Frame; emit: Emit; state: AntigravityStreamState }, _options = {}) {
  if (!state.textEmitted) responseText({ text: result.response, emit, state });
  if (result.status !== 'SUCCESS') {
    emit({ type: 'error', message: typeof result.error === 'string' ? result.error : 'Antigravity did not complete the turn.' });
  }
  if (result.usage !== undefined) {
    const usage = record(result.usage);
    emit({ type: 'usage', usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
      thought_tokens: usage.thinking_tokens, cached_read_tokens: usage.cache_read_tokens } });
  }
}

/** Translate real tool receipts through the shared tool_use/tool_result audit channel.
 * Pure except for the caller-owned parser state and event sink. O(1) per frame.
 */
export function handleAntigravityEvent({ frame, emit, state }: {
  frame: unknown; emit: Emit; state: AntigravityStreamState;
}, _options: Record<string, never> = {}): boolean {
  const obj = record(frame);
  if (obj.event === 'init') {
    emit({ type: 'status', label: 'initializing', model: record(obj.init).model });
    return true;
  }
  if (obj.event === 'result') {
    terminalResult({ result: record(obj.result), emit, state });
    return true;
  }
  if (obj.event !== 'step_update') return false;
  const step = record(obj.step_update);
  if (step.step_type === 'agent_response') responseText({ text: step.text_delta, emit, state });
  if (step.step_type === 'tool') toolStep({ step, emit, state });
  return true;
}
