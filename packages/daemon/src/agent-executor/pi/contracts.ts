export interface PiExecutorOptions {
  /** Post-completion pi RPC grace period, resolved once at native composition. */
  readonly piGracefulShutdownMs?: number;
}
