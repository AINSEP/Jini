/**
 * Use the OS-provided Speech models without a separate recognition-model download; a
 * roughly 75 MB bundled-model alternative was deliberately avoided. The native helper
 * requires on-device recognition: missing locale assets are an unavailable/rejected result,
 * never a silent network fallback that uploads private recordings. Compile lazily so a
 * checkout without swiftc can report unavailable instead of failing installation.
 */
import path from "node:path";
import type { TranscriptionAvailability, TranscriptionPort, TranscriptionResult } from "../transcription-port.js";
export interface MacTranscriberMessages {
  compilerMissing: string;
  compilerFailed(args: { stderr: string }): string;
  invalidOutput(args: { stdout: string }): string;
  cannotTranscribe(args: { reason: string }): string;
  recognitionFailed(args: { reason: string }): string;
}
interface SpawnResult {
  status: number | null;
  stderr?: Buffer | string;
  error?: NodeJS.ErrnoException;
}

// The narrow filesystem port permits in-memory fakes without replacing the process adapter.
interface TranscriberFs {
  existsSync(args: { path: string }): boolean;
  mkdirSync(args: { path: string }, options?: { recursive?: boolean }): unknown;
  writeFileSync(args: { path: string; data: Buffer }): void;
  rmSync(args: { path: string }, options?: { force?: boolean }): void;
}

interface CompileDeps {
  fs: Pick<TranscriberFs, "existsSync" | "mkdirSync">;
  /** @deprecated Accepted for host compatibility; never called. Use execFileAsync. */
  spawnSync?: (args: { command: string; args: string[] }) => SpawnResult;
  execFileAsync: (args: { file: string; args: string[] }) => Promise<{ stdout: string }>;
  sourcePath: string;
  binaryPath: string;
  compilerPath: string;
  messages: MacTranscriberMessages;
}

// The success arm keeps error?: undefined so consumers without strictNullChecks can read
// error even when their compiler cannot narrow this union on ok.
type CompileResult = { ok: true; error?: undefined } | { ok: false; error: string };

interface AvailabilityDeps extends CompileDeps {
  locale: string;
}

interface MacTranscriberDeps extends AvailabilityDeps {
  fs: TranscriberFs;
  tempFilePath: () => string;
}

interface HelperPayload {
  available?: unknown;
  reason?: string | null;
  ok?: boolean;
  text?: string;
  elapsedMs?: number;
  error?: string;
}

// An existing binary is a cache hit, not a rebuild check; remove the cached output after
// editing the Swift source to force recompilation.
// Availability and transcription can arrive together on first use. Share the compiler by output
// path within one filesystem port; separate injected filesystems must not share fake/cache state.
const compilations = new WeakMap<CompileDeps["fs"], Map<string, Promise<CompileResult>>>();

/** Compile asynchronously so swiftc's first-use work cannot freeze an Electron main thread. */
async function compileHelper({ fs, execFileAsync, sourcePath, binaryPath, compilerPath, messages }: CompileDeps): Promise<CompileResult> {
  fs.mkdirSync({ path: path.dirname(binaryPath) }, { recursive: true });
  try {
    await execFileAsync({ file: compilerPath, args: ["-O", sourcePath, "-o", binaryPath] });
    return { ok: true };
  } catch (error) {
    const failure = error !== null && typeof error === "object"
      ? error as { code?: unknown; stderr?: unknown }
      : null;
    if (failure?.code === "ENOENT") return { ok: false, error: messages.compilerMissing };
    const diagnostic = failure?.stderr;
    const stderr = typeof diagnostic === "string" || Buffer.isBuffer(diagnostic)
      ? diagnostic.toString().trim()
      : "";
    return { ok: false, error: messages.compilerFailed({ stderr }) };
  }
}

/** Compile once at the caller-supplied source and binary paths; retry after a failed attempt. */
async function ensureHelperCompiled(deps: CompileDeps, _optionalArgs: Record<string, never> = {}): Promise<CompileResult> {
  let pendingByPath = compilations.get(deps.fs);
  const key = path.resolve(deps.binaryPath);
  const pending = pendingByPath?.get(key);
  // swiftc may create its output before it exits. In-flight work takes precedence over existsSync,
  // or a second caller could execute a partially linked binary while the first still compiles.
  if (pending) return pending;
  if (deps.fs.existsSync({ path: deps.binaryPath })) return { ok: true };
  if (!pendingByPath) {
    pendingByPath = new Map();
    compilations.set(deps.fs, pendingByPath);
  }
  const compiling = compileHelper(deps);
  pendingByPath.set(key, compiling);
  try {
    return await compiling;
  } finally {
    pendingByPath.delete(key);
  }
}

// Include the raw helper stdout in malformed-output errors so the payload is debuggable
// without separately collecting a child-process log.
/** Parse structured helper output and report malformed payloads with host wording. */
function parseHelperJson({ stdout, invalidOutput }: { stdout: string; invalidOutput: MacTranscriberMessages["invalidOutput"] }): HelperPayload {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError();
    return parsed as HelperPayload;
  } catch {
    throw new Error(invalidOutput({ stdout }));
  }
}

/**
 * The helper prints structured failures and exits nonzero for both subcommands.
 * execFile attaches stdout to its rejection, so recover that JSON rather than losing the
 * native failure reason behind a generic process-exit error.
 */
async function runHelperJson({ execFileAsync, binaryPath, args, messages }: Pick<AvailabilityDeps, "execFileAsync" | "binaryPath" | "messages"> & { args: string[] }): Promise<HelperPayload> {
  try {
    const { stdout } = await execFileAsync({ file: binaryPath, args });
    return parseHelperJson({ stdout, invalidOutput: messages.invalidOutput });
  } catch (error) {
    if (error !== null && typeof error === "object" && typeof (error as { stdout?: unknown }).stdout === "string" && (error as { stdout: string }).stdout.trim().length > 0) {
      return parseHelperJson({ stdout: (error as { stdout: string }).stdout, invalidOutput: messages.invalidOutput });
    }
    throw error;
  }
}

/** Probe compiled helper capability without recording audio. */
async function checkAvailability(deps: AvailabilityDeps): Promise<TranscriptionAvailability> {
  const compiled = await ensureHelperCompiled(deps);
  if (!compiled.ok) return { available: false, reason: compiled.error };

  const result = await runHelperJson({ execFileAsync: deps.execFileAsync, binaryPath: deps.binaryPath, args: ["check", deps.locale], messages: deps.messages });
  if (typeof result.available !== "boolean" || (result.reason != null && typeof result.reason !== "string")) throw new Error(deps.messages.invalidOutput({ stdout: JSON.stringify(result) }));
  return { available: result.available, reason: result.reason ?? undefined };
}

/** Transcribe scratch WAV input and remove the recording on every completion path. */
async function transcribeWav({ wavBuffer, ...deps }: MacTranscriberDeps & { wavBuffer: Buffer }): Promise<TranscriptionResult> {
  const compiled = await ensureHelperCompiled(deps);
  if (!compiled.ok) throw new Error(deps.messages.cannotTranscribe({ reason: compiled.error }));

  const tempPath = deps.tempFilePath();
  try {
    deps.fs.writeFileSync({ path: tempPath, data: wavBuffer });
    const result = await runHelperJson({ execFileAsync: deps.execFileAsync, binaryPath: deps.binaryPath, args: ["transcribe", tempPath, deps.locale], messages: deps.messages });
    if (result.ok !== true) throw new Error(deps.messages.recognitionFailed({ reason: result.error ?? "" }));
    if ((result.text !== undefined && typeof result.text !== "string") || (result.elapsedMs !== undefined && (typeof result.elapsedMs !== "number" || !Number.isFinite(result.elapsedMs)))) {
      throw new Error(deps.messages.invalidOutput({ stdout: JSON.stringify(result) }));
    }
    return { text: result.text ?? "", elapsedMs: result.elapsedMs ?? 0 };
  } finally {
    deps.fs.rmSync({ path: tempPath }, { force: true });
  }
}

/** Construct a native port with explicit filesystem, process and temp-file dependencies. */
function createMacOnDeviceTranscriptionPort(deps: MacTranscriberDeps): TranscriptionPort {
  return {
    isAvailable: () => checkAvailability(deps),
    transcribe: ({ wavBuffer }) => transcribeWav({ ...deps, wavBuffer }),
  };
}

export {
  createMacOnDeviceTranscriptionPort,
  ensureHelperCompiled,
  checkAvailability,
  transcribeWav,
  parseHelperJson,
};
export type { AvailabilityDeps, CompileDeps, CompileResult, HelperPayload, MacTranscriberDeps, SpawnResult, TranscriberFs };
