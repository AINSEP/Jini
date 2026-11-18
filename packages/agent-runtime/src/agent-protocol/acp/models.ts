/** @module agent-protocol/acp/models
 * ACP model detection, normalisation, and config-option selection. The primary
 * export `detectAcpModels` spawns an ACP subprocess, performs the
 * `initialize` + `session/new` handshake, and returns the available model list.
 * Consumed by runtime adapter definitions. Depends on the core JSON-line
 * stream and acp/types, acp/constants, acp/json, acp/rpc, and
 * acp/session-params.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createJsonLineStream } from '../core/index.js';
import type { JsonRpcId, UnknownRecord, TimerHandle } from './types.js';
import { ACP_PROTOCOL_VERSION, DEFAULT_TIMEOUT_MS, MODEL_CONFIG_OPTION_IDS } from './constants.js';
import { errorMessage, resolveAcpTimeoutMs, asObject } from './json.js';
import { sendRpc, rpcErrorMessage } from './rpc.js';
import { buildAcpSessionNewParams } from './session-params.js';

/** A single model entry exposed to the daemon's model-selection UI and to `session/set_model` calls. */
export interface ModelOption {
  id: string;
  label: string;
}
/** Parsed model-selection config option extracted from an ACP `session/new` result's `configOptions` array. */
export interface AcpModelConfigOption {
  configId: string;
  currentValue: string | null;
  values: unknown[];
}
/** Options accepted by `detectAcpModels` to control how the probe subprocess is launched and identified. */
export interface DetectAcpModelsOptions {
  bin: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
  defaultModelOption?: ModelOption;
  signal?: AbortSignal;
  onSessionResult?: (result: UnknownRecord) => void;
  /** Process effect port; metadata tests use a child fake rather than replacing modules. */
  spawnProcess?: typeof spawn;
}
/**
 * Normalises a raw config-option field value to a lowercase, whitespace- and
 * punctuation-stripped token for fuzzy matching against `MODEL_CONFIG_OPTION_IDS`.
 *
 * @param value - A raw field value from an ACP config option object.
 * @returns A normalised token string, or `''` when `value` is not a string.
 */
export function normalizeConfigOptionToken({ value }: { value: unknown }, _optional: Record<string, never> = {}): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s_-]+/g, '')
    : '';
}
/**
 * Returns `true` when the given `option` object from `configOptions` represents
 * a model-selection config option, using a cascade of category, id, and name
 * normalisation checks against `MODEL_CONFIG_OPTION_IDS`.
 *
 * @param option - A single item from the `configOptions` array.
 * @param configId - The trimmed `id` field of that item.
 */
export function isModelConfigOption({ option, configId }: { option: UnknownRecord; configId: string }, _optional: Record<string, never> = {}): boolean {
  const category = normalizeConfigOptionToken({ value: option.category });
  if (category === 'model') return true;
  const id = normalizeConfigOptionToken({ value: configId });
  if (id === 'model') return true;
  if (category) return false;
  const name = normalizeConfigOptionToken({ value: option.name });
  return MODEL_CONFIG_OPTION_IDS.has(id) || name === 'model';
}
/**
 * Scans the `configOptions` array from an ACP `session/new` result and returns
 * the first entry that passes `isModelConfigOption`. Returns `null` when no
 * model config option is found, so callers can fall back to the `models` field.
 *
 * @param configOptions - The raw `result.configOptions` value from a session response.
 * @returns A parsed `AcpModelConfigOption` or `null` when absent.
 */
export function findModelConfigOption({ configOptions }: { configOptions: unknown }, _optional: Record<string, never> = {}): AcpModelConfigOption | null {
  const options = Array.isArray(configOptions) ? configOptions : [];
  for (const rawOption of options) {
    const parsed = parseModelConfigOption(rawOption);
    if (parsed) return parsed;
  }
  return null;
}
/** Returns the trimmed string when `value` is a string, else `''`. */
function trimmedOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
/** Parses one `configOptions` entry, returning it only when it is a
 * select-type (or untyped) model-selection option with a non-blank id. */
function parseModelConfigOption(rawOption: unknown): AcpModelConfigOption | null {
  const option = asObject({ value: rawOption });
  if (!option) return null;
  const configId = trimmedOrEmpty(option.id);
  if (!configId) return null;
  const type = trimmedOrEmpty(option.type);
  if (type && type !== 'select') return null;
  if (!isModelConfigOption({ option, configId })) return null;
  return {
    configId,
    currentValue: trimmedOrEmpty(option.currentValue) || null,
    values: Array.isArray(option.options) ? option.options : [],
  };
}
/** One candidate model as read from either the config-option or legacy path. */
interface ModelEntry {
  id: string;
  name: string;
}
/** Builds the deduplicated option list: `defaultModelOption` first, then each
 * entry with a non-blank unseen id, labelled `name (id)` when a distinct name
 * exists and suffixed ` • current` for `currentId`. */
function buildModelOptions({
  defaultModelOption,
  currentId,
  entries,
}: {
  defaultModelOption: ModelOption;
  currentId: string | null;
  entries: ModelEntry[];
}): ModelOption[] {
  const seen = new Set([defaultModelOption.id]);
  const out = [defaultModelOption];
  for (const { id, name } of entries) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const labelBase = name && name !== id ? `${name} (${id})` : id;
    out.push({ id, label: id === currentId ? `${labelBase} • current` : labelBase });
  }
  return out;
}
/** Reads a config-option value entry: id from `value` (when non-blank) else `id`. */
function configOptionEntry(value: UnknownRecord): ModelEntry {
  return {
    id: trimmedOrEmpty(value.value) || trimmedOrEmpty(value.id),
    name: trimmedOrEmpty(value.name),
  };
}
/** Reads a legacy `models.availableModels` entry. */
function legacyModelEntry(model: unknown): ModelEntry {
  const obj = asObject({ value: model });
  return { id: trimmedOrEmpty(obj?.modelId), name: trimmedOrEmpty(obj?.name) };
}
/**
 * Extracts and normalises the available models list from an ACP
 * `configOptions` array (preferred) into a `ModelOption[]`. Prepends
 * `defaultModelOption` and deduplicates by id. Returns `null` when no model
 * config option is found in `configOptions`.
 *
 * @param configOptions - The raw `result.configOptions` from a session response.
 * @param defaultModelOption - The fallback option to prepend to the list.
 * @returns `{ currentModelId, models }` or `null` when no config option is found.
 */
export function normalizeModelConfigOptions(
  { configOptions, defaultModelOption }: { configOptions: unknown; defaultModelOption: ModelOption }, _optional: Record<string, never> = {},
): { currentModelId: string | null; models: ModelOption[] } | null {
  const modelConfig = findModelConfigOption({ configOptions });
  if (!modelConfig) return null;
  const entries: ModelEntry[] = [];
  for (const rawValue of modelConfig.values) {
    const value = asObject({ value: rawValue });
    if (value) entries.push(configOptionEntry(value));
  }
  const models = buildModelOptions({
    defaultModelOption,
    currentId: modelConfig.currentValue,
    entries,
  });
  return { currentModelId: modelConfig.currentValue, models };
}
/**
 * Produces the final ordered `ModelOption[]` for a session, merging the
 * `configOptions` path (preferred when it yields more than one option) with
 * the legacy `models.availableModels` path. Always includes `defaultModelOption`
 * at position zero and deduplicates by id.
 *
 * @param models - The raw `result.models` value from a `session/new` response.
 * @param defaultModelOption - The fallback option to prepend.
 * @param configOptions - Optional `result.configOptions` for the config-option path.
 * @returns A deduplicated array of `ModelOption` items.
 */
export function normalizeModels({ models, defaultModelOption }: { models: unknown; defaultModelOption: ModelOption }, { configOptions }: { configOptions?: unknown } = {}
): ModelOption[] {
  const configModels = normalizeModelConfigOptions({ configOptions, defaultModelOption });
  if (configModels && configModels.models.length > 1) {
    return configModels.models;
  }
  const out = legacyModelOptions({ models, defaultModelOption });
  return out.length > 1 || !configModels ? out : configModels.models;
}
/** The legacy `result.models.availableModels` path of `normalizeModels`. */
function legacyModelOptions({
  models,
  defaultModelOption,
}: {
  models: unknown;
  defaultModelOption: ModelOption;
}): ModelOption[] {
  const modelsObj = asObject({ value: models });
  const available: unknown[] = Array.isArray(modelsObj?.availableModels) ? modelsObj.availableModels : [];
  const currentId =
    typeof modelsObj?.currentModelId === 'string' ? modelsObj.currentModelId : null;
  return buildModelOptions({ defaultModelOption, currentId, entries: available.map(legacyModelEntry) });
}
/**
 * Returns `true` for JSON-RPC error codes that indicate a model-selection
 * failure from which the session can recover by falling back to the default
 * model and sending the prompt anyway.
 *
 * @param code - The `error.code` value from a JSON-RPC error response.
 */
export function modelSelectionErrorIsRecoverable({ code }: { code: unknown }, _optional: Record<string, never> = {}): boolean {
  return code === -32603 || code === -32602 || code === -32601 || code === -32002;
}
/**
 * Reads the currently active model id from a `session/new` (or
 * `session/set_model`) result object, checking `configOptions` first and
 * falling back to `models.currentModelId`. Returns `null` when neither is set.
 *
 * @param result - The parsed `result` object from a session handshake response.
 */
export function currentModelFromSessionResult({ result }: { result: UnknownRecord }, _optional: Record<string, never> = {}): string | null {
  const configCurrent = findModelConfigOption({ configOptions: result.configOptions })?.currentValue;
  if (configCurrent) return configCurrent;
  const models = asObject({ value: result.models });
  return typeof models?.currentModelId === 'string' && models.currentModelId.trim()
    ? models.currentModelId.trim()
    : null;
}
/**
 * Probes a running ACP binary by spawning it, performing the
 * `initialize` → `session/new` handshake, and reading the model list from the
 * session result. The child is killed with `SIGTERM` once the list is
 * extracted or the timeout expires.
 *
 * Used by runtime adapter definitions to populate the model-selection dropdown
 * without waiting for an actual prompt run.
 *
 * @param options.bin - Absolute path or `$PATH`-resolvable name of the ACP binary.
 * @param options.args - CLI arguments to pass to the binary.
 * @param options.cwd - Working directory for the probe subprocess.
 * @param options.env - Environment for the probe subprocess (default: `process.env`).
 * @param options.timeoutMs - Hard timeout for the probe; subject to `MAX_TIMEOUT_MS`.
 * @param options.clientName - Client name sent in the `initialize` handshake.
 * @param options.clientVersion - Client version sent in the `initialize` handshake.
 * @param options.defaultModelOption - Fallback option prepended to the result list.
 * @returns A promise resolving to the available `ModelOption[]`.
 */
export async function detectAcpModels(requiredArgs: Pick<DetectAcpModelsOptions, "bin" | "args">, optionalArgs: Omit<DetectAcpModelsOptions, "bin" | "args"> = {}): Promise<ModelOption[]> {
  const config = resolveProbeConfig({ ...optionalArgs, ...requiredArgs });
  return await new Promise<ModelOption[]>((resolve, reject) => startProbe({ config, resolve, reject }));
}

type ProbeConfig = Required<Omit<DetectAcpModelsOptions, 'signal' | 'onSessionResult'>>
  & { signal: AbortSignal | undefined; onSessionResult: DetectAcpModelsOptions['onSessionResult'] | undefined }
  & { effectiveTimeoutMs: number };

/** Mutable state of one in-flight model probe, shared by its handlers. */
interface ProbeRun {
  config: ProbeConfig;
  child: ChildProcessWithoutNullStreams;
  resolve: (value: ModelOption[]) => void;
  reject: (error: Error) => void;
  settled: boolean;
  closed: boolean;
  stderrBuf: string;
  stdoutBytes: number;
  expectedId: number;
  timer: TimerHandle | null;
  abort: () => void;
}

function resolveProbeConfig(options: DetectAcpModelsOptions): ProbeConfig {
  const {
    cwd = process.cwd(),
    env = process.env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    clientName = 'agent-runtime-detect',
    clientVersion = 'runtime-adapter',
    defaultModelOption = { id: 'default', label: 'Default (CLI config)' },
    spawnProcess = spawn,
  } = options;
  return {
    bin: options.bin, args: options.args, cwd, env, timeoutMs, clientName, clientVersion,
    defaultModelOption, spawnProcess, signal: options.signal, onSessionResult: options.onSessionResult,
    effectiveTimeoutMs: resolveAcpTimeoutMs({ env, fallbackMs: timeoutMs }),
  };
}

function finishProbe<T extends ModelOption[] | Error>({ run, fn, value }: {
  run: ProbeRun;
  fn: (value: T) => void;
  value: T;
}): void {
  if (run.settled) return;
  run.settled = true;
  if (run.timer) clearTimeout(run.timer);
  run.config.signal?.removeEventListener('abort', run.abort);
  if (run.closed) fn(value);
  else finishAcpProbeProcess({ child: run.child, complete: () => fn(value) });
}

function failProbe({ run, message }: { run: ProbeRun; message: string }): void {
  finishProbe({ run, fn: run.reject, value: new Error(message) });
}

function writeProbeRpc(run: ProbeRun, rpc: { id: JsonRpcId; method: string; params: unknown }): void {
  try {
    sendRpc({ writable: run.child.stdin, id: rpc.id, method: rpc.method, params: rpc.params });
  } catch (err) {
    failProbe({ run, message: `stdin write failed: ${errorMessage({ err })}` });
  }
}

function handleProbeRpcError({ run, obj, rpcErr }: {
  run: ProbeRun;
  obj: UnknownRecord | null;
  rpcErr: string;
}): void {
  // JSON-RPC -32603 "Internal error" during model detection:
  // If this is for the current expected-id (initialize/session/new),
  // it's a real probe failure — reject immediately.
  // Otherwise it's cleanup noise — suppress it.
  if (asObject({ value: obj?.error })?.code === -32603 && obj?.id !== run.expectedId) return;
  failProbe({ run, message: rpcErr });
}

function handleProbeResult(run: ProbeRun, result: UnknownRecord): void {
  const { config } = run;
  if (run.expectedId === 1) {
    run.expectedId = 2;
    writeProbeRpc(run, { id: 2, method: 'session/new', params: buildAcpSessionNewParams({ cwd: config.cwd }) });
    return;
  }
  config.onSessionResult?.(result);
  const models = normalizeModels({ models: result.models, defaultModelOption: config.defaultModelOption }, { configOptions: result.configOptions });
  finishProbe({ run, fn: run.resolve, value: models });
}

function handleProbeMessage({ run, raw }: { run: ProbeRun; raw: unknown }): void {
  const obj = asObject({ value: raw });
  const rpcErr = rpcErrorMessage({ raw });
  if (rpcErr) {
    handleProbeRpcError({ run, obj, rpcErr });
    return;
  }
  const result = asObject({ value: obj?.result });
  if (obj?.id !== run.expectedId || !result) return;
  handleProbeResult(run, result);
}

type ProbeParser = ReturnType<typeof createJsonLineStream>;

function handleProbeStdout({ run, parser, chunk }: {
  run: ProbeRun;
  parser: ProbeParser;
  chunk: string;
}): void {
  run.stdoutBytes += Buffer.byteLength(String(chunk), 'utf8');
  if (run.stdoutBytes > 8 * 1024 * 1024) { failProbe({ run, message: 'ACP metadata output exceeded its limit' }); return; }
  parser.feed({ chunk: chunk });
}

function handleProbeClose({ run, parser, exit }: {
  run: ProbeRun;
  parser: ProbeParser;
  exit: { code: number | null; signal: NodeJS.Signals | null };
}): void {
  run.closed = true;
  parser.flush();
  if (run.settled) return;
  const errTail = run.stderrBuf.trim();
  const suffix = errTail ? ` stderr=${errTail}` : '';
  failProbe({
    run,
    message: `ACP model detection exited code=${exit.code} signal=${exit.signal ?? 'none'}${suffix}`,
  });
}

function wireProbeListeners(run: ProbeRun): void {
  const { child } = run;
  const parser = createJsonLineStream({
    onMessage: ({ message: raw }) => handleProbeMessage({ run, raw }),
  }, { onError: error => failProbe({ run, message: error.message }) });
  child.stdout.on('data', (chunk) => handleProbeStdout({ run, parser, chunk }));
  child.stdout.on('close', () => parser.flush());
  child.stdin.on('error', (err) => failProbe({ run, message: `stdin error: ${err.message}` }));
  child.stderr.on('data', (chunk) => {
    run.stderrBuf = `${run.stderrBuf}${chunk}`.slice(-16_000);
  });
  child.on('error', (err) => failProbe({ run, message: `spawn failed: ${err.message}` }));
  child.on('close', (code, signal) => handleProbeClose({ run, parser, exit: { code, signal } }));
}

function startProbe({ config, resolve, reject }: {
  config: ProbeConfig;
  resolve: ProbeRun['resolve'];
  reject: ProbeRun['reject'];
}): void {
  if (config.signal?.aborted) throw new Error('ACP model detection aborted');
  const child = config.spawnProcess(config.bin, config.args, {
    cwd: config.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...config.env },
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  const run: ProbeRun = {
    config, child, resolve, reject, settled: false, closed: false, stderrBuf: '', stdoutBytes: 0,
    expectedId: 1, timer: null, abort: () => failProbe({ run, message: 'ACP model detection aborted' }),
  };
  config.signal?.addEventListener('abort', run.abort, { once: true });
  wireProbeListeners(run);
  if (config.effectiveTimeoutMs > 0) {
    run.timer = setTimeout(() => {
      failProbe({ run, message: `ACP model detection timed out after ${config.effectiveTimeoutMs}ms` });
    }, config.effectiveTimeoutMs);
  }
  writeProbeRpc(run, { id: 1, method: 'initialize', params: {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: { terminal: false },
    clientInfo: { name: config.clientName, version: config.clientVersion },
  } });
}

/**
 * Ends a finished probe and completes after close, or after exit plus a pipe-drain grace.
 * Descendants may inherit stdout, so waiting indefinitely for close can hold the scheduler slot.
 * The process scheduler must retain its slot until exit, including the SIGKILL grace
 * period. Returning at metadata receipt would overlap this child with the next probe.
 * @param requiredArgs - The owned child and the callback that settles its probe result.
 * @param _optionalArgs - Reserved optional controls.
 * @returns Nothing; completes once and removes its timers and lifecycle listeners.
 * @complexity O(1) time and space, excluding stream teardown.
 */
function finishAcpProbeProcess({ child, complete }: {
  child: ChildProcessWithoutNullStreams;
  complete: () => void;
}, _optionalArgs = {}): void {
  let completed = false;
  let exitTimer: TimerHandle | null = null;
  const settle = () => {
    if (completed) return;
    completed = true;
    clearTimeout(killTimer);
    if (exitTimer) clearTimeout(exitTimer);
    child.removeListener('exit', afterExit);
    child.removeListener('close', settle);
    complete();
  };
  const afterExit = () => {
    clearTimeout(killTimer);
    child.removeListener('exit', afterExit);
    exitTimer = setTimeout(() => {
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      settle();
    }, 250);
    exitTimer.unref();
  };
  const killTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 250);
  killTimer.unref();
  child.once('close', settle);
  child.once('exit', afterExit);
  if (child.exitCode !== null || child.signalCode) afterExit();
  try {
    child.stdin.end();
  } catch {}
  if (!child.killed) child.kill('SIGTERM');
}

/** Retains native current selection. Session creation can write CLI state/start services;
 * this metadata probe never sends session/prompt. The old array API remains compatible. */
export async function detectAcpModelMetadata(requiredArgs: Pick<DetectAcpModelsOptions, 'bin' | 'args'>,
  optionalArgs: Omit<DetectAcpModelsOptions, 'bin' | 'args'> = {},
): Promise<{ models: ModelOption[]; currentModelId: string | null }> {
  let currentModelId: string | null = null;
  const models = await detectAcpModels(requiredArgs, { ...optionalArgs, onSessionResult: (result) => {
    currentModelId = currentModelFromSessionResult({ result });
    optionalArgs.onSessionResult?.(result);
  } });
  return { models: models.filter((model) => model.id !== 'default').map((model) => {
    const label = model.label.replace(/ • current$/, '');
    const suffix = ` (${model.id})`;
    // Remove only our ID annotation; native display-name capability suffixes are meaningful.
    return { ...model, label: label.endsWith(suffix) ? label.slice(0, -suffix.length) : label };
  }), currentModelId };
}
