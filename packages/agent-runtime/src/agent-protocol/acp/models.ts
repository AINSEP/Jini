/** @module agent-protocol/acp/models
 * ACP model detection, normalisation, and config-option selection. The primary
 * export `detectAcpModels` spawns an ACP subprocess, performs the
 * `initialize` + `session/new` handshake, and returns the available model list.
 * Consumed by runtime adapter definitions. Depends on the core JSON-line
 * stream and acp/types, acp/constants, acp/json, acp/rpc, and
 * acp/session-params.
 */
import { spawn } from 'node:child_process';
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
export function normalizeConfigOptionToken(value: unknown): string {
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
export function isModelConfigOption(option: UnknownRecord, configId: string): boolean {
  const category = normalizeConfigOptionToken(option.category);
  if (category === 'model') return true;
  const id = normalizeConfigOptionToken(configId);
  if (id === 'model') return true;
  if (category) return false;
  const name = normalizeConfigOptionToken(option.name);
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
export function findModelConfigOption(configOptions: unknown): AcpModelConfigOption | null {
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
  const option = asObject(rawOption);
  if (!option) return null;
  const configId = trimmedOrEmpty(option.id);
  if (!configId) return null;
  const type = trimmedOrEmpty(option.type);
  if (type && type !== 'select') return null;
  if (!isModelConfigOption(option, configId)) return null;
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
  const obj = asObject(model);
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
  configOptions: unknown,
  defaultModelOption: ModelOption,
): { currentModelId: string | null; models: ModelOption[] } | null {
  const modelConfig = findModelConfigOption(configOptions);
  if (!modelConfig) return null;
  const entries: ModelEntry[] = [];
  for (const rawValue of modelConfig.values) {
    const value = asObject(rawValue);
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
  const configModels = normalizeModelConfigOptions(configOptions, defaultModelOption);
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
  const modelsObj = asObject(models);
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
export function modelSelectionErrorIsRecoverable(code: unknown): boolean {
  return code === -32603 || code === -32602 || code === -32601 || code === -32002;
}
/**
 * Reads the currently active model id from a `session/new` (or
 * `session/set_model`) result object, checking `configOptions` first and
 * falling back to `models.currentModelId`. Returns `null` when neither is set.
 *
 * @param result - The parsed `result` object from a session handshake response.
 */
export function currentModelFromSessionResult(result: UnknownRecord): string | null {
  const configCurrent = findModelConfigOption(result.configOptions)?.currentValue;
  if (configCurrent) return configCurrent;
  const models = asObject(result.models);
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
  const {
  bin,
  args,
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  clientName = 'agent-runtime-detect',
  clientVersion = 'runtime-adapter',
  defaultModelOption = { id: 'default', label: 'Default (CLI config)' },
  signal,
  onSessionResult,
  spawnProcess = spawn,
}: DetectAcpModelsOptions = { ...optionalArgs, ...requiredArgs };
  const effectiveTimeoutMs = resolveAcpTimeoutMs(env, timeoutMs);
  return await new Promise<ModelOption[]>((resolve, reject) => {
    const child = spawnProcess(bin, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...env },
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    let settled = false;
    let closed = false;
    let stderrBuf = '';
    let stdoutBytes = 0;
    let expectedId = 1;

    let timer: TimerHandle | null = null;
    const finish = <T extends ModelOption[] | Error>(fn: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      try {
        child.stdin.end();
      } catch {}
      if (!child.killed) child.kill('SIGTERM');
      const killTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 250);
      killTimer.unref();
      // The process scheduler must retain its slot until exit, including the SIGKILL grace
      // period. Returning at metadata receipt would overlap this child with the next probe.
      if (closed) { clearTimeout(killTimer); fn(value); }
      else child.once('close', () => { clearTimeout(killTimer); fn(value); });
    };

    const fail = (message: string) => {
      finish(reject, new Error(message));
    };
    const abort = () => fail('ACP model detection aborted');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }

    const writeRpc = (id: JsonRpcId, method: string, params: unknown) => {
      try {
        sendRpc(child.stdin, id, method, params);
      } catch (err) {
        fail(`stdin write failed: ${errorMessage(err)}`);
      }
    };

    const handleRpcError = (obj: UnknownRecord | null, rpcErr: string) => {
      // JSON-RPC -32603 "Internal error" during model detection:
      // If this is for the current expected-id (initialize/session/new),
      // it's a real probe failure — reject immediately.
      // Otherwise it's cleanup noise — suppress it.
      if (asObject(obj?.error)?.code === -32603 && obj?.id !== expectedId) return;
      fail(rpcErr);
    };

    const handleResult = (result: UnknownRecord) => {
      if (expectedId === 1) {
        expectedId = 2;
        writeRpc(2, 'session/new', buildAcpSessionNewParams({ cwd: cwd }));
        return;
      }
      onSessionResult?.(result);
      const models = normalizeModels({ models: result.models, defaultModelOption: defaultModelOption }, { configOptions: result.configOptions });
      finish(resolve, models);
    };

    const parser = createJsonLineStream({ onMessage: ({ message: raw }) => {
      const obj = asObject(raw);
      const rpcErr = rpcErrorMessage(raw);
      if (rpcErr) {
        handleRpcError(obj, rpcErr);
        return;
      }
      const result = asObject(obj?.result);
      if (obj?.id !== expectedId || !result) return;
      handleResult(result);
    } });

    child.stdout.on('data', (chunk) => {
      stdoutBytes += Buffer.byteLength(String(chunk), 'utf8');
      if (stdoutBytes > 8 * 1024 * 1024) { fail('ACP metadata output exceeded its limit'); return; }
      parser.feed({ chunk: chunk });
    });
    child.stdout.on('close', () => parser.flush());
    child.stdin.on('error', (err) => fail(`stdin error: ${err.message}`));
    child.stderr.on('data', (chunk) => {
      stderrBuf = `${stderrBuf}${chunk}`.slice(-16_000);
    });
    child.on('error', (err) => fail(`spawn failed: ${err.message}`));
    child.on('close', (code, signal) => {
      closed = true;
      parser.flush();
      if (!settled) {
        const errTail = stderrBuf.trim();
        const suffix = errTail ? ` stderr=${errTail}` : '';
        fail(`ACP model detection exited code=${code} signal=${signal ?? 'none'}${suffix}`);
      }
    });

    if (effectiveTimeoutMs > 0) {
      timer = setTimeout(() => {
        fail(`ACP model detection timed out after ${effectiveTimeoutMs}ms`);
      }, effectiveTimeoutMs);
    }

    writeRpc(1, 'initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { terminal: false },
      clientInfo: { name: clientName, version: clientVersion },
    });
  });
}

/** Retains native current selection. Session creation can write CLI state/start services;
 * this metadata probe never sends session/prompt. The old array API remains compatible. */
export async function detectAcpModelMetadata(requiredArgs: Pick<DetectAcpModelsOptions, 'bin' | 'args'>,
  optionalArgs: Omit<DetectAcpModelsOptions, 'bin' | 'args'> = {},
): Promise<{ models: ModelOption[]; currentModelId: string | null }> {
  let currentModelId: string | null = null;
  const models = await detectAcpModels(requiredArgs, { ...optionalArgs, onSessionResult: (result) => {
    currentModelId = currentModelFromSessionResult(result);
    optionalArgs.onSessionResult?.(result);
  } });
  return { models: models.filter((model) => model.id !== 'default').map((model) => {
    const label = model.label.replace(/ • current$/, '');
    const suffix = ` (${model.id})`;
    // Remove only our ID annotation; native display-name capability suffixes are meaningful.
    return { ...model, label: label.endsWith(suffix) ? label.slice(0, -suffix.length) : label };
  }), currentModelId };
}
