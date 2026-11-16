/** A single running PTY child process, however the caller's backend spawns it. */
export interface PtyProcess {
  onData(cb: (chunk: string) => void): void;
  onExit(cb: (event: { exitCode: number; signal?: number }) => void): void;
  write(input: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export interface PtySpawnOptions {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

/** Spawns a PTY. The caller supplies this — e.g. a thin wrapper around `node-pty`'s `spawn`. */
export type PtySpawn = (shell: string, args: string[], options: PtySpawnOptions) => PtyProcess;

export type TerminalEventData = { data: string } | { code: number | null; signal: string | null };

export interface TerminalEventRecord {
  id: number;
  event: 'data' | 'exit';
  data: TerminalEventData;
  timestamp: number;
  byteLength: number;
}

/** A minimal push sink a transport adapts its live connection to (e.g. SSE). */
export interface TerminalSseSink {
  send(event: string, data: TerminalEventData, id: number): void;
  end(): void;
}

export interface TerminalSessionState {
  readonly id: string;
  readonly cwd: string;
  readonly shell: string;
  readonly cols: number;
  readonly rows: number;
  readonly status: 'running' | 'exited';
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export interface TerminalSession extends TerminalSessionState {
  readonly projectId: string | null;
}

export interface CreateTerminalOptions {
  projectId?: string | null;
  cwd: string;
  cols?: number;
  rows?: number;
  shell?: string | null;
}

export interface CreateTerminalServiceOptions {
  /** Lazily loads the PTY spawner. Concurrent `create()` calls share one attempt; success is cached, failure permits retry. */
  loadSpawnPty: () => Promise<PtySpawn>;
  /** Count backstop for the per-session output ring-buffer; `maxBufferBytes` is the real ceiling. */
  maxEvents?: number;
  /** UTF-8 byte ceiling for retained reattach scrollback (evicted oldest-first; the newest event is always kept). */
  maxBufferBytes?: number;
  /** Trailing scrollback kept once a shell exits, so an unreaped session doesn't pin memory. */
  exitTailBytes?: number;
  /** Coalesces PTY output for roughly one animation frame before fanning out one `data` event. */
  flushIntervalMs?: number;
  /** Flushes immediately once buffered output crosses this size, bypassing the frame timer. */
  flushThresholdBytes?: number;
  /** Drops an exited session from the registry after this idle window. */
  ttlMs?: number;
  /** Grace window given to children to exit during {@link TerminalService.shutdownActive}. */
  shutdownGraceMs?: number;
}

export interface TerminalService {
  create(options: CreateTerminalOptions): Promise<TerminalSession>;
  get(id: string): TerminalSession | null;
  list(filter?: { projectId?: string | null }): TerminalSession[];
  write(id: string, input: string): boolean;
  resize(id: string, cols: number, rows: number): boolean;
  kill(id: string, signal?: string): boolean;
  /** Replays scrollback after `lastEventId`, then attaches `sink` for live output if still running. */
  attach(id: string, lastEventId: number, sink: TerminalSseSink): 'attached' | 'ended' | 'not-found';
  detach(id: string, sink: TerminalSseSink): void;
  shutdownActive(options?: { graceMs?: number }): Promise<void>;
  isTerminal(status: string): boolean;
}

export interface PtyPort { createTerminalService(required: CreateTerminalServiceOptions): TerminalService; }
