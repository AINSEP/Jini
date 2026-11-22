import type { Readable } from "node:stream";

/** Startup output beyond this is a runaway child, not a readiness line. */
const MAX_BOOT_OUTPUT_CHARS = 1_000_000;

export interface ReadinessChild {
  pid?: number | undefined;
  stdout: Readable | null;
  stderr: Readable | null;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
}
export interface ChildReadinessOutputSink { write(chunk: string): unknown; end(): unknown }
export type ChildReadinessFailure =
  | { type: "timeout"; text: string; readyTimeoutMs: number }
  | { type: "exit"; text: string; code: number | null; signal: NodeJS.Signals | null }
  | { type: "missing-pid"; text: string }
  | { type: "missing-stream"; text: string }
  | { type: "output-limit"; text: string; maxOutputChars: number };
export interface ChildReadinessRequired<T> {
  child: ReadinessChild;
  readyTimeoutMs: number;
  parseReady(required: { text: string }): T | null;
  onReady(required: { ready: T; pid: number; text: string }): void;
  createOutputSink(required: { stream: "stdout" | "stderr" }): ChildReadinessOutputSink;
  describeFailure(required: ChildReadinessFailure): string;
}
interface ReadinessRun {
  output: string;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}
interface ReadinessWait<T> {
  ports: ChildReadinessRequired<T>;
  run: ReadinessRun;
  resolve(info: { ready: T; pid: number }): void;
  reject(error: Error): void;
}

/** Whichever of readiness, timeout, or exit arrives first owns the outcome. */
function finish({ run }: { run: ReadinessRun }, _optional = {}): boolean {
  if (run.settled) return false;
  run.settled = true;
  clearTimeout(run.timer);
  return true;
}

function fail<T>({ wait, error }: { wait: ReadinessWait<T>; error: Error }, _optional = {}): void {
  if (finish({ run: wait.run })) wait.reject(error);
}

function settleOnReady<T>({ wait }: { wait: ReadinessWait<T> }, _optional = {}): void {
  const { ports, run } = wait;
  const ready = ports.parseReady({ text: run.output });
  if (ready === null) return;
  // A readiness line normally proves this child spawned and has a process id.
  const pid = ports.child.pid;
  if (pid == null) return fail({ wait, error: new Error(ports.describeFailure({ type: "missing-pid", text: run.output })) });
  if (!finish({ run })) return;
  ports.onReady({ ready, pid, text: run.output });
  wait.resolve({ ready, pid });
  run.output = ""; // Parsing is finished; the host sink alone retains its bounded diagnostic tail.
}

function acceptChunk<T>({ wait, chunk }: { wait: ReadinessWait<T>; chunk: string }, _optional = {}): void {
  const { run, ports } = wait;
  if (run.settled) return;
  if (run.output.length + chunk.length > MAX_BOOT_OUTPUT_CHARS) {
    return fail({ wait, error: new Error(ports.describeFailure({ type: "output-limit", text: run.output, maxOutputChars: MAX_BOOT_OUTPUT_CHARS })) });
  }
  run.output += chunk;
  settleOnReady({ wait });
}

/** Feed raw chunks to parsing, and keep draining through the host sink after settlement.
 * Framing, redaction before retention/mirroring, and diagnostic bounds belong to that sink. */
function readStream<T>(
  { wait, stream, name }: { wait: ReadinessWait<T>; stream: Readable; name: "stdout" | "stderr" }, _optional = {},
): void {
  stream.setEncoding("utf8");
  const sink = wait.ports.createOutputSink({ stream: name });
  stream.once("end", () => sink.end());
  stream.on("data", (chunk: string) => {
    sink.write(chunk);
    acceptChunk({ wait, chunk });
  });
}

function watchChildEnd<T>({ wait }: { wait: ReadinessWait<T> }, _optional = {}): void {
  const { ports, run } = wait;
  // Preserve the native spawn error, including its identity and cause.
  ports.child.once("error", error => fail({ wait, error }));
  ports.child.once("exit", (code, signal) => {
    if (!finish({ run })) return;
    wait.reject(new Error(ports.describeFailure({ type: "exit", text: run.output, code, signal })));
  });
}

/** Wait for parsed readiness with one settlement and a bounded raw startup buffer.
 * The callback receives all accumulated text so identity and startup credentials are read in order.
 * @returns Parsed readiness and the native child pid.
 * @complexity O(n) in startup output, bounded by one million characters. */
export function waitForChildReady<T>(
  ports: ChildReadinessRequired<T>, _optional = {},
): Promise<{ ready: T; pid: number }> {
  return new Promise((resolve, reject) => {
    const run: ReadinessRun = { output: "", settled: false, timer: undefined };
    const wait: ReadinessWait<T> = { ports, run, resolve, reject };
    run.timer = setTimeout(() => {
      if (!finish({ run })) return;
      reject(new Error(ports.describeFailure({ type: "timeout", text: run.output, readyTimeoutMs: ports.readyTimeoutMs })));
    }, ports.readyTimeoutMs);
    if (!ports.child.stdout || !ports.child.stderr) {
      fail({ wait, error: new Error(ports.describeFailure({ type: "missing-stream", text: run.output })) });
      return;
    }
    readStream({ wait, stream: ports.child.stdout, name: "stdout" });
    readStream({ wait, stream: ports.child.stderr, name: "stderr" });
    watchChildEnd({ wait });
  });
}
