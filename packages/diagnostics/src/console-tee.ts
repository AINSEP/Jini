import { format } from "node:util";
import { Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/**
 * @file Formats console output once and redacts it before either the terminal or buffer sees it.
 * Generic (no host-product concepts): the capture target is the structural `ConsoleTeeBuffer` port, so a host
 * passes its own log buffer without this module knowing its source vocabulary.
 *
 * Capture must never break logging: a failing redactor emits a safe placeholder, never raw text;
 * a failing or full buffer can only lose the captured copy, never the original console call.
 */

type ConsoleMethod = "debug" | "log" | "info" | "warn" | "error";

/**
 * A capture step that failed and was replaced by a safe fallback. The `error` may quote the text that
 * was being redacted, so a reporter must treat it like the raw output: count it or log its class,
 * never print its message to an unredacted sink.
 */
export interface CaptureFailure {
  readonly stage: "redact" | "format" | "append";
  readonly error: unknown;
}

/** Receives each {@link CaptureFailure}; must not throw. Defaults to ignoring them (the output still degrades safely). */
export type CaptureFailureReporter = (failure: CaptureFailure) => void;

const ignoreFailure: CaptureFailureReporter = () => undefined;

/**
 * Frames child output before invoking the caller's existing redactor, including an unterminated
 * final line. Never closes the parent sink. Oversized lines are discarded whole so cutting a
 * credential before redaction cannot expose a fragment. Redactor failures emit fixed copy.
 * @param required Parent sink and redaction policy; no process globals are read.
 * @param optional Input-line and rendered-line limits, in characters; `onFailure` hears each redactor failure.
 * @returns A writable for one child stream; ending it, or its source unpiping at EOF, flushes the last line.
 * @complexity O(n) time for n input characters; O(maxLineLength) retained space.
 * @example child.stderr.pipe(createRedactedOutputSink({ sink: process.stderr, redact }));
 */
export function createRedactedOutputSink(
  { sink, redact }: { sink: Pick<Writable, "write">; redact: (required: { text: string }) => string },
  { maxLineLength = 65_536, maxLength = 2_000, onFailure = ignoreFailure }: { maxLineLength?: number; maxLength?: number; onFailure?: CaptureFailureReporter } = {},
): Writable {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let oversized = false;
  const emit = () => {
    let safe = "[output redaction failed]";
    try { safe = oversized ? "[oversized output line omitted]" : redact({ text: pending }); }
    catch (error) { onFailure({ stage: "redact", error }); } // Raw child bytes must never be the fallback.
    if (safe) sink.write(`${safe.slice(0, maxLength)}\n`);
    pending = "";
    oversized = false;
  };
  const append = ({ text }: { text: string }, _optional = {}) => {
    let start = 0;
    while (start < text.length) {
      const newline = text.indexOf("\n", start);
      const end = newline === -1 ? text.length : newline;
      if (!oversized && pending.length + end - start > maxLineLength) { pending = ""; oversized = true; }
      if (!oversized) pending += text.slice(start, end);
      if (newline === -1) return;
      emit();
      start = newline + 1;
    }
  };
  const flush = () => { append({ text: decoder.end() }); if (pending || oversized) emit(); };
  const writable = new Writable({
    write(chunk: Buffer, _encoding, done) { append({ text: decoder.write(chunk) }); done(); },
    final(done) { flush(); done(); },
  });
  // A source piped with { end: false } (Jini's daemon adapter keeps host sinks open across respawns)
  // never calls end(); its EOF only unpipes, and the unterminated last line is often the native crash.
  writable.on("unpipe", flush);
  return writable;
}

/** Severity of a captured line; `log` and `info` both map to `info`. */
export type ConsoleTeeLevel = "debug" | "info" | "warn" | "error";

/**
 * The capture target. `append` is declared as a method so a host buffer whose `source` is a narrower
 * union than `string` is still assignable (method parameters are compared bivariantly).
 */
export interface ConsoleTeeBuffer {
  append(input: { readonly level: ConsoleTeeLevel; readonly source: string; readonly message: string }): unknown;
}

const LEVEL_BY_METHOD: Record<ConsoleMethod, ConsoleTeeLevel> = {
  debug: "debug", log: "info", info: "info", warn: "warn", error: "error",
};

/** The slice of `console` the tee replaces; injectable so tests never patch the real console. */
export type TeeableConsole = Record<ConsoleMethod, (...args: unknown[]) => void>;

export interface InstallConsoleTeeRequired {
  readonly buffer: ConsoleTeeBuffer;
}

export interface InstallConsoleTeeOptional {
  /** Defaults to the global `console`. */
  readonly target?: TeeableConsole;
  /** Tag stored with each line; defaults to `"server"`. */
  readonly source?: string;
  /** Applied before both copies; defaults to identity. Redactor failure never exposes raw text. */
  readonly redact?: (required: { text: string }, optional?: Record<string, never>) => string;
  /** Hears each formatting, redaction or buffer failure; the console call is never interrupted by it. */
  readonly onFailure?: CaptureFailureReporter;
}

function safeAppend(
  { buffer, level, source, message }: { buffer: ConsoleTeeBuffer; level: ConsoleTeeLevel; source: string; message: string },
  { onFailure = ignoreFailure }: { onFailure?: CaptureFailureReporter } = {},
): void {
  try {
    buffer.append({ level, source, message });
  } catch (error) {
    // Losing one captured line is acceptable; throwing out of console.error is not.
    onFailure({ stage: "append", error });
  }
}

/**
 * Wraps console.debug/log/info/warn/error so each call is also appended to the buffer.
 * The original method receives the formatted, redacted string before the buffer copy is appended.
 * @param required The buffer to append to.
 * @param optional Console to patch (tests), source tag and injected redactor.
 * @returns Uninstall, restoring exactly the methods this call replaced.
 * @complexity O(n) formatting space/time for n output characters, plus the injected redactor and buffer.
 * @example const uninstall = installConsoleTee({ buffer });
 */
export function installConsoleTee(required: InstallConsoleTeeRequired, optional: InstallConsoleTeeOptional = {}): () => void {
  const target = optional.target ?? (console as unknown as TeeableConsole);
  const source = optional.source ?? "server";
  const redact = optional.redact ?? (({ text }) => text);
  const onFailure = optional.onFailure ?? ignoreFailure;
  const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();
  for (const method of Object.keys(LEVEL_BY_METHOD) as ConsoleMethod[]) {
    const original = target[method];
    originals.set(method, original);
    target[method] = (...args: unknown[]) => {
      let message = "[log redaction failed]";
      try {
        message = redact({ text: format(...args) });
      } catch (error) {
        // Formatting or redaction failure must never send the raw arguments to a log shipper.
        onFailure({ stage: "format", error });
      }
      original.call(target, message);
      safeAppend({ buffer: required.buffer, level: LEVEL_BY_METHOD[method], source, message }, { onFailure });
    };
  }
  return () => {
    for (const [method, original] of originals) target[method] = original;
  };
}
